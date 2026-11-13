import { randomBytes } from "node:crypto";
import { guardrailErrors } from "./guardrails";
import type { Ledger } from "./ledger";
import type { Proposal } from "./types";

// Stubs for the only two delivery paths that exist: a transactional email provider
// and the app's in-app/push service. Swap these for real clients; nothing else changes.
export interface DeliveryProvider {
  send(to: string, message: string): Promise<{ id: string }>;
}

export const outbox: { channel: string; to: string; message: string; at: string }[] = [];

function stub(channel: string): DeliveryProvider {
  return {
    async send(to, message) {
      if (process.env.FAIL_DELIVERY === channel) throw new Error(`${channel} provider unavailable`);
      outbox.push({ channel, to, message, at: new Date().toISOString() });
      return { id: `${channel}-${outbox.length}` };
    },
  };
}

export const providers: Record<Proposal["channel"], DeliveryProvider> = {
  email: stub("email"),
  push: stub("push"),
};

// Single-use promo codes. Production: a codes table (code, pct, max_redemptions=1,
// redeemed_at) that checkout validates against.
export const promoCodes = new Map<string, { pct: number; fanId: string; redeemed: boolean }>();

function issuePromoCode(fanId: string, pct: number): string {
  const code = `SW-${randomBytes(3).toString("hex").toUpperCase()}`;
  promoCodes.set(code, { pct, fanId, redeemed: false });
  return code;
}

// Approve = final guardrail check -> claim ledger slot -> issue code -> send.
// Order matters: the ledger claim happens BEFORE the provider call so a double
// click or a retry can never send twice.
export async function approveAndSend(p: Proposal, ledger: Ledger): Promise<Proposal> {
  if (p.status !== "pending") return { ...p, error: `Can't send: status is ${p.status}.` };

  const errs = guardrailErrors(p);
  if (errs.length) return { ...p, error: errs.join(" ") };

  const promoCode = p.offer === "promo_code" ? issuePromoCode(p.fanId, p.discountPct) : undefined;
  const claimed = ledger.record({
    key: p.id,
    fanId: p.fanId,
    channel: p.channel,
    sentAt: new Date().toISOString(),
    promoCode,
  });
  if (!claimed) {
    if (promoCode) promoCodes.delete(promoCode);
    return { ...p, error: "Already sent to this fan for this match. Blocked duplicate." };
  }

  const message = promoCode ? p.message.replaceAll("{{PROMO_CODE}}", promoCode) : p.message;
  try {
    await providers[p.channel].send(p.fanId, message);
    return { ...p, status: "sent", promoCode, message, error: undefined };
  } catch (err) {
    // The slot stays claimed so an automatic retry can't double-send.
    // A person must check the provider and retry on purpose.
    return { ...p, status: "failed", promoCode, error: `Send failed: ${(err as Error).message}. Not retried automatically.` };
  }
}
