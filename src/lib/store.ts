import carts from "@/data/staleCarts.json";
import { approveAndSend } from "@/engine/delivery";
import { computeEconomics, runEngine } from "@/engine/engine";
import { guardrailErrors } from "@/engine/guardrails";
import { createMemoryLedger, type Ledger } from "@/engine/ledger";
import type { EngineResult, Proposal, RawCart } from "@/engine/types";

// POC state lives in memory (on globalThis so it survives dev hot reloads).
// Production: proposals, ledger and an audit log in Postgres.
interface AuditEntry {
  at: string;
  proposalId: string;
  action: string;
  detail?: string;
}

interface State {
  ledger: Ledger;
  result: EngineResult | null;
  audit: AuditEntry[];
}

const g = globalThis as unknown as { __offerState?: State };
const state: State = (g.__offerState ??= { ledger: createMemoryLedger(), result: null, audit: [] });

function log(proposalId: string, action: string, detail?: string) {
  state.audit.unshift({ at: new Date().toISOString(), proposalId, action, detail });
}

export async function getState() {
  if (!state.result) state.result = await runEngine(carts as RawCart[], { ledger: state.ledger });
  return { ...state.result, audit: state.audit };
}

export async function rerun() {
  // Pending items are rebuilt. Sent fans are skipped by the ledger.
  // Decisions already made (sent / rejected / failed) are kept so they never reappear as new.
  const decided = (state.result?.proposals ?? []).filter((p) => p.status !== "pending");
  const fresh = await runEngine(carts as RawCart[], { ledger: state.ledger });
  const decidedIds = new Set(decided.map((p) => p.id));
  fresh.proposals = [...decided, ...fresh.proposals.filter((p) => !decidedIds.has(p.id))];
  fresh.skipped = fresh.skipped.filter((s) => !(s.category === "already_contacted" && decided.some((d) => d.cartIds.join() === s.cartIds.join())));
  fresh.summary = {
    ...fresh.summary,
    proposals: fresh.proposals.length,
    skipped: fresh.skipped.length,
    discounted: fresh.proposals.filter((p) => p.discountPct > 0).length,
    aiMessages: fresh.proposals.filter((p) => p.messageSource === "ai").length,
  };
  state.result = fresh;
  log("-", "rerun");
  return getState();
}

export type Action =
  | { type: "approve" }
  | { type: "reject"; note?: string }
  | { type: "edit"; message?: string; discountPct?: number; channel?: Proposal["channel"] };

export async function act(id: string, action: Action) {
  const s = await getState();
  const idx = s.proposals.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error("Proposal not found");
  const current = s.proposals[idx];
  let next: Proposal;

  if (action.type === "approve") {
    next = await approveAndSend(current, state.ledger);
    log(id, next.error ? (next.status === "failed" ? "send_failed" : "approve_blocked") : "approved+sent", next.error);
  } else if (action.type === "reject") {
    if (current.status !== "pending") throw new Error(`Can't reject: status is ${current.status}`);
    next = { ...current, status: "rejected", error: undefined };
    log(id, "rejected", action.note);
  } else {
    if (current.status !== "pending") throw new Error(`Can't edit: status is ${current.status}`);
    const draft: Proposal = {
      ...current,
      message: action.message ?? current.message,
      discountPct: action.discountPct ?? current.discountPct,
      channel: action.channel ?? current.channel,
      offer: (action.discountPct ?? current.discountPct) > 0 ? "promo_code" : current.offer === "promo_code" ? "reminder_only" : current.offer,
      editedBy: "marketer",
    };
    const errs = guardrailErrors(draft);
    if (errs.length) {
      log(id, "edit_blocked", errs.join(" "));
      return { ok: false, errors: errs, state: await getState() };
    }
    next = {
      ...draft,
      economics: computeEconomics(draft.cartValue, draft.offer, draft.discountPct, draft.sectionSoldPct),
      error: undefined,
    };
    log(id, "edited");
  }

  state.result!.proposals[idx] = next;
  return { ok: !next.error, errors: next.error ? [next.error] : [], state: await getState() };
}
