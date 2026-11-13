import { beforeAll, describe, expect, it } from "vitest";
import carts from "../src/data/staleCarts.json";
import { runEngine } from "../src/engine/engine";
import { approveAndSend, outbox } from "../src/engine/delivery";
import { guardrailErrors } from "../src/engine/guardrails";
import { createMemoryLedger } from "../src/engine/ledger";
import { templateMessage, type CopyWriter } from "../src/engine/message";
import type { EngineResult, Proposal, RawCart } from "../src/engine/types";

// Tests never call the model: copy comes from the template.
const templateCopy: CopyWriter = async (i) => ({ message: templateMessage(i), source: "template" });
const raw = carts as RawCart[];

let r: EngineResult;
beforeAll(async () => {
  r = await runEngine(raw, { copy: templateCopy, ledger: createMemoryLedger() });
});

const proposalFor = (cartId: string) => r.proposals.find((p) => p.cartIds.includes(cartId));
const skipFor = (cartId: string) => r.skipped.find((s) => s.cartIds.includes(cartId));

describe("nothing disappears silently", () => {
  it("every cart ends up in exactly one place (offer or skipped)", () => {
    const all = [...r.proposals.flatMap((p) => p.cartIds), ...r.skipped.flatMap((s) => s.cartIds)];
    expect(all.sort()).toEqual(raw.map((c) => c.cartId).sort());
  });
  it("every skipped cart has a reason", () => {
    for (const s of r.skipped) expect(s.reason.length).toBeGreaterThan(10);
  });
});

describe("data edge cases from the sample", () => {
  it("C-1001 + C-1006: same fan, same match -> ONE offer", () => {
    const p = proposalFor("C-1001");
    expect(p).toBeDefined();
    expect(p!.cartIds.sort()).toEqual(["C-1001", "C-1006"]);
    expect(r.proposals.filter((x) => x.fanId === "F-204")).toHaveLength(1);
  });
  it("C-1008 guest is linked to F-511 and merged with C-1002", () => {
    const p = proposalFor("C-1008");
    expect(p?.fanId).toBe("F-511");
    expect(p!.cartIds.sort()).toEqual(["C-1002", "C-1008"]);
  });
  it("C-1005: match already played -> no offer", () => {
    expect(proposalFor("C-1005")).toBeUndefined();
    expect(skipFor("C-1005")?.category).toBe("match_passed");
  });
  it("C-1007: onboarding team with unsynced data -> no offer, reason mentions data", () => {
    expect(proposalFor("C-1007")).toBeUndefined();
    const s = skipFor("C-1007");
    expect(s?.category).toBe("team_not_enabled");
    expect(s?.reason).toMatch(/Not synced/);
  });
});

describe("revenue judgment", () => {
  it("never discounts high-demand sections (>= 80% sold)", () => {
    for (const id of ["C-1001", "C-1003", "C-1004"]) expect(proposalFor(id)?.discountPct).toBe(0);
  });
  it("season pass holder C-1004 gets no discount and is flagged for sales", () => {
    const p = proposalFor("C-1004")!;
    expect(p.offer).toBe("reminder_only");
    expect(p.flags.join(" ")).toMatch(/sales/i);
  });
  it("first-time fan in a low-demand section (F-511) gets a capped promo", () => {
    const p = proposalFor("C-1002")!;
    expect(p.offer).toBe("promo_code");
    expect(p.discountPct).toBeGreaterThan(0);
    expect(p.discountPct).toBeLessThanOrEqual(15);
  });
});

describe("consent + guardrails", () => {
  it("never uses a channel the fan opted out of", () => {
    for (const p of r.proposals) expect(p.optIns[p.channel]).toBe(true);
  });
  it("C-1003 (email opt-out) goes via push", () => {
    expect(proposalFor("C-1003")?.channel).toBe("push");
  });
  it("F-511 (push opt-out) goes via email", () => {
    expect(proposalFor("C-1002")?.channel).toBe("email");
  });
  it("all generated proposals pass guardrails", () => {
    for (const p of r.proposals) expect(guardrailErrors(p)).toEqual([]);
  });
  it("blocks a discount above 15%", () => {
    const p = { ...proposalFor("C-1002")!, discountPct: 20, message: "20% off {{PROMO_CODE}}" };
    expect(guardrailErrors(p).join(" ")).toMatch(/cap/);
  });
  it("blocks copy that promises a different discount", () => {
    const p = { ...proposalFor("C-1001")!, message: "Get 15% off now!" };
    expect(guardrailErrors(p).length).toBeGreaterThan(0);
  });
  it("blocks switching to an opted-out channel", () => {
    const p: Proposal = { ...proposalFor("C-1003")!, channel: "email" };
    expect(guardrailErrors(p).join(" ")).toMatch(/email/);
  });
});

describe("never send twice", () => {
  it("second approval of the same proposal is blocked", async () => {
    const ledger = createMemoryLedger();
    const res = await runEngine(raw, { copy: templateCopy, ledger });
    const p = res.proposals.find((x) => x.offer === "promo_code")!;
    const before = outbox.length;

    const first = await approveAndSend(p, ledger);
    expect(first.status).toBe("sent");
    expect(first.promoCode).toMatch(/^SW-/);
    expect(first.message).toContain(first.promoCode!);

    const second = await approveAndSend(p, ledger); // same pending proposal again (double click / retry)
    expect(second.status).toBe("pending");
    expect(second.error).toMatch(/Already sent/);
    expect(outbox.length).toBe(before + 1);
  });

  it("re-running the engine skips fans already contacted", async () => {
    const ledger = createMemoryLedger();
    const first = await runEngine(raw, { copy: templateCopy, ledger });
    await approveAndSend(first.proposals[0], ledger);
    const second = await runEngine(raw, { copy: templateCopy, ledger });
    expect(second.proposals.find((p) => p.id === first.proposals[0].id)).toBeUndefined();
    expect(second.skipped.some((s) => s.category === "already_contacted")).toBe(true);
  });

  it("a failed send is reported, not hidden, and not auto-retried", async () => {
    const ledger = createMemoryLedger();
    const res = await runEngine(raw, { copy: templateCopy, ledger });
    const p = res.proposals.find((x) => x.channel === "push")!;
    process.env.FAIL_DELIVERY = "push";
    const out = await approveAndSend(p, ledger);
    delete process.env.FAIL_DELIVERY;
    expect(out.status).toBe("failed");
    expect(out.error).toMatch(/Send failed/);
  });
});
