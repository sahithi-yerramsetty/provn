import type { Cart, Channel, OfferType } from "./types";

// The model only WRITES the fan-facing copy. It never decides who gets an offer,
// how big the discount is, or which channel. That split is deliberate:
// - rules = money, consent, safety (must be exact and testable)
// - model = tone and wording (where variety and warmth help, and a mistake is caught
//   by guardrails + a human before anything is sent)

export interface CopyInput {
  offer: OfferType;
  discountPct: number;
  channel: Channel;
  cart: Cart;
  team: string;
}

export interface CopyResult {
  message: string;
  source: "ai" | "template";
  note?: string;
}

export function templateMessage(i: CopyInput): string {
  const when = i.cart.daysUntilMatch === 1 ? "tomorrow" : `in ${i.cart.daysUntilMatch} days`;
  const plural = i.cart.seats > 1;
  const seats = `${i.cart.seats} ${i.cart.section} seat${plural ? "s" : ""}`;
  const are = plural ? "are" : "is";
  const them = plural ? "they're" : "it's";
  switch (i.offer) {
    case "promo_code":
      return `Your ${seats} for the ${i.team} match ${when} ${are} still waiting. Here's ${i.discountPct}% off to finish your order: {{PROMO_CODE}} (one-time use).`;
    case "merch_addon":
      return `Still thinking about your ${seats}? Complete your order for the ${i.team} match ${when} and add team gear at checkout.`;
    default:
      return `Your ${seats} for the ${i.team} match ${when} ${are} still in your cart. This section is filling up — finish your order before ${them} gone.`;
  }
}

export type CopyWriter = (i: CopyInput) => Promise<CopyResult>;

// Default writer: uses Claude if ANTHROPIC_API_KEY is set, otherwise the template.
// Any failure falls back to the template AND is reported (never silent).
export const writeCopy: CopyWriter = async (i) => {
  const key = process.env.ANTHROPIC_API_KEY;
  const fallback = templateMessage(i);
  if (!key) return { message: fallback, source: "template" };

  const limit = i.channel === "push" ? 160 : 400;
  const prompt = [
    `Write one short ${i.channel} message to a rugby fan who left tickets in their cart.`,
    `Team: ${i.team}. Seats: ${i.cart.seats} in ${i.cart.section}. Match in ${i.cart.daysUntilMatch} days.`,
    i.discountPct > 0
      ? `Offer: ${i.discountPct}% off with a one-time code. Write the code as {{PROMO_CODE}} exactly.`
      : `Offer: none. Do NOT mention any discount, percentage or code.`,
    `Max ${limit} characters. Friendly, plain English, no emojis, no invented facts. Return only the message.`,
  ].join("\n");

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-5-5",
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = data.content?.find((b) => b.type === "text")?.text?.trim();
    if (!text) throw new Error("empty response");
    if (text.length > limit) throw new Error("too long");
    if (i.discountPct > 0 && !text.includes("{{PROMO_CODE}}")) throw new Error("missing code placeholder");
    return { message: text, source: "ai" };
  } catch (err) {
    return { message: fallback, source: "template", note: `AI copy failed (${(err as Error).message}); used template` };
  }
};
