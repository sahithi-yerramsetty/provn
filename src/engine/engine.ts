import { CONFIG } from "./config";
import { chooseChannel, decideOffer, type CartGroup } from "./decide";
import { guardrailErrors } from "./guardrails";
import { resolveIdentity, SAMPLE_EMAIL_LINKS, staticIdentityLookup, type IdentityLookup } from "./identity";
import { createMemoryLedger, type Ledger } from "./ledger";
import { writeCopy, type CopyWriter } from "./message";
import { normalize } from "./normalize";
import type { Cart, EngineResult, Proposal, RawCart, Skipped } from "./types";

export interface EngineDeps {
  identity?: IdentityLookup;
  ledger?: Ledger;
  copy?: CopyWriter;
}

const TRIGGER = "cart_winback";

export function proposalKey(team: string, fanId: string, matchKey: string): string {
  return `${team}:${fanId}:${matchKey}:${TRIGGER}`;
}

// Pipeline:
// 1 normalize -> 2 resolve identity -> 3 group (dedupe) -> 4 eligibility rules
// -> 5 one offer per fan -> 6 decide offer + channel (rules) -> 7 write copy (AI)
// -> 8 guardrail check. Every cart ends up in proposals OR skipped, with a reason.
export async function runEngine(raw: RawCart[], deps: EngineDeps = {}): Promise<EngineResult> {
  const identity = deps.identity ?? staticIdentityLookup(SAMPLE_EMAIL_LINKS);
  const ledger = deps.ledger ?? createMemoryLedger();
  const copy = deps.copy ?? writeCopy;

  const skipped: Skipped[] = [];
  const skip = (carts: Cart[], category: Skipped["category"], reason: string) =>
    skipped.push({ cartIds: carts.map((c) => c.cartId), fanId: carts[0]?.fanId ?? null, category, reason });

  // 1-2
  const carts = resolveIdentity(raw.map(normalize), identity);

  // 3. Group by fan + match.
  const groups = new Map<string, Cart[]>();
  for (const c of carts) {
    if (!c.fanId) {
      skip([c], "unlinked_guest", "Guest checkout with no matching fan account. Can't check consent or history.");
      continue;
    }
    const k = `${c.fanId}|${c.matchKey}`;
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }

  // 4. Eligibility.
  const eligible: CartGroup[] = [];
  for (const group of groups.values()) {
    const byRecent = [...group].sort((a, b) => (a.hoursSinceAbandon ?? 1e9) - (b.hoursSinceAbandon ?? 1e9));
    const primary = byRecent[0];
    const profile = group.find((c) => !c.linkedFrom && c.dataIssues.length === 0) ?? primary;
    const fanId = primary.fanId!;

    if (!(CONFIG.enabledTeams as readonly string[]).includes(primary.team)) {
      const issues = group.flatMap((c) => c.dataIssues);
      skip(group, "team_not_enabled",
        `"${primary.team}" is not enabled for offers yet (sprint 1 = Seawolves only)` +
          (issues.length ? `; data not ready: ${issues.join(", ")}` : "") + ".");
      continue;
    }
    if (primary.daysUntilMatch === null) {
      skip(group, "bad_data", `Can't tell when the match is ("${primary.matchLabel}").`);
      continue;
    }
    if (primary.daysUntilMatch < 0) {
      skip(group, "match_passed", `Match already played ${-primary.daysUntilMatch} days ago. Nothing to win back.`);
      continue;
    }
    if (primary.sectionSoldPct === null || primary.hoursSinceAbandon === null) {
      skip(group, "bad_data", `Missing key fields: ${primary.dataIssues.join(", ")}.`);
      continue;
    }
    if (primary.hoursSinceAbandon < CONFIG.minHoursSinceAbandon) {
      skip(group, "too_recent", "Abandoned less than an hour ago; give the fan time to come back.");
      continue;
    }
    if (primary.hoursSinceAbandon > CONFIG.maxHoursSinceAbandon) {
      skip(group, "bad_data", "Cart is older than 7 days; too stale to act on.");
      continue;
    }
    if (ledger.has(proposalKey(primary.team, fanId, primary.matchKey))) {
      skip(group, "already_contacted", "Already sent a win-back for this fan and match.");
      continue;
    }
    eligible.push({ fanId, matchKey: primary.matchKey, carts: group, primary, profile });
  }

  // 5. One offer per fan per run: keep the highest-value cart group.
  const bestByFan = new Map<string, CartGroup>();
  for (const g of eligible) {
    const cur = bestByFan.get(g.fanId);
    if (!cur || (g.primary.cartValue ?? 0) > (cur.primary.cartValue ?? 0)) {
      if (cur) skip(cur.carts, "duplicate", "Fan already has a higher-value offer this run.");
      bestByFan.set(g.fanId, g);
    } else {
      skip(g.carts, "duplicate", "Fan already has a higher-value offer this run.");
    }
  }

  // 6-8.
  const proposals: Proposal[] = [];
  let ai = 0;
  let fallbacks = 0;
  for (const g of bestByFan.values()) {
    const channel = chooseChannel(g);
    if (!channel) {
      skip(g.carts, "no_contact_channel", "Fan opted out of both email and push.");
      continue;
    }
    const d = decideOffer(g, channel);
    const c = await copy({ offer: d.offer, discountPct: d.discountPct, channel, cart: g.primary, team: g.primary.team });
    if (c.source === "ai") ai++;
    else if (c.note) fallbacks++;

    const p: Proposal = {
      id: proposalKey(g.primary.team, g.fanId, g.matchKey),
      fanId: g.fanId,
      team: g.primary.team,
      cartIds: g.carts.map((x) => x.cartId),
      matchLabel: g.primary.matchLabel,
      section: g.primary.section,
      seats: g.primary.seats,
      cartValue: g.primary.cartValue,
      offer: d.offer,
      discountPct: d.discountPct,
      channel,
      optIns: { email: g.profile.emailOptIn, push: g.profile.pushOptIn },
      reason: d.reason,
      message: c.message,
      messageSource: c.source,
      flags: c.note ? [...d.flags, c.note] : d.flags,
      status: "pending",
    };

    // Rules should never produce a bad proposal. If they do, it's a bug: surface it.
    const errs = guardrailErrors(p);
    if (errs.length) p.flags.push(...errs.map((e) => `GUARDRAIL: ${e}`));
    proposals.push(p);
  }

  return {
    proposals,
    skipped,
    summary: {
      cartsIn: raw.length,
      proposals: proposals.length,
      skipped: skipped.length,
      discounted: proposals.filter((p) => p.discountPct > 0).length,
      aiMessages: ai,
      templateFallbacks: fallbacks,
    },
  };
}
