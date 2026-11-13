import { CONFIG } from "./config";
import type { Proposal } from "./types";

// Hard rules. Checked when a proposal is created, after every marketer edit,
// and again right before send. A failure blocks the action and is shown in the UI.
export function guardrailErrors(p: Proposal): string[] {
  const errors: string[] = [];

  if (p.channel === "email" && !p.optIns.email) errors.push("Fan has not opted in to email.");
  if (p.channel === "push" && !p.optIns.push) errors.push("Fan has not opted in to push.");

  if (!Number.isFinite(p.discountPct) || p.discountPct < 0) errors.push("Discount must be 0 or more.");
  if (p.discountPct > CONFIG.maxDiscountPct)
    errors.push(`Discount ${p.discountPct}% is above the ${CONFIG.maxDiscountPct}% cap.`);
  if (p.offer === "promo_code" && p.discountPct === 0) errors.push("Promo code offer needs a discount.");
  if (p.offer !== "promo_code" && p.discountPct > 0) errors.push("Only promo code offers can carry a discount.");

  if (p.offer === "promo_code" && p.status === "pending" && !p.message.includes("{{PROMO_CODE}}"))
    errors.push("Promo message must include {{PROMO_CODE}} so the real code can be inserted.");
  if (p.offer !== "promo_code" && p.message.includes("{{PROMO_CODE}}"))
    errors.push("Message has a code placeholder but the offer has no code.");

  if (!p.message.trim()) errors.push("Message is empty.");
  if (p.channel === "push" && p.message.length > 180) errors.push("Push message is over 180 characters.");

  // Copy must not promise a different discount than the one we will issue.
  const pcts = [...p.message.matchAll(/(\d+)\s*%/g)].map((m) => Number(m[1]));
  if (pcts.some((n) => n !== p.discountPct)) errors.push("Message mentions a discount that doesn't match the offer.");
  if (p.discountPct > 0 && !pcts.includes(p.discountPct))
    errors.push("Message should state the discount.");

  return errors;
}
