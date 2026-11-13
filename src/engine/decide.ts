import { CONFIG } from "./config";
import type { Cart, Channel, OfferType } from "./types";

// A group = all carts from one fan for one match (duplicates folded together).
export interface CartGroup {
  fanId: string;
  matchKey: string;
  carts: Cart[];
  primary: Cart; // most recent cart: best signal of channel + intent
  profile: Cart; // cart with the most trustworthy fan history
}

export interface Decision {
  offer: OfferType;
  discountPct: number;
  channel: Channel;
  reason: string;
  flags: string[];
}

// Deterministic rules. These decide WHO gets WHAT, so they must be testable,
// explainable and identical every run. No model call here on purpose.
export function chooseChannel(g: CartGroup): Channel | null {
  const { emailOptIn, pushOptIn } = g.profile;
  // Reach fans where they abandoned, if they allow it.
  if (g.primary.source === "app" && pushOptIn) return "push";
  if (emailOptIn) return "email";
  if (pushOptIn) return "push";
  return null;
}

export function decideOffer(g: CartGroup, channel: Channel): Decision {
  const p = g.profile;
  const c = g.primary;
  const sold = c.sectionSoldPct ?? 0;
  const days = c.daysUntilMatch ?? 0;
  const flags: string[] = [];

  if (g.carts.length > 1) flags.push(`Merged ${g.carts.length} carts: ${g.carts.map((x) => x.cartId).join(", ")}`);
  if (c.linkedFrom || g.carts.some((x) => x.linkedFrom)) flags.push("Includes a guest cart linked by email");

  // 1. High-value fans: no discount, hand to the salesperson.
  const isVip = p.seasonPass || (p.lifetimeTickets ?? 0) >= CONFIG.vipLifetimeTickets;
  if (isVip) {
    flags.push("High-value fan: suggest a personal call from sales");
    return {
      offer: "reminder_only",
      discountPct: 0,
      channel,
      reason: `${p.seasonPass ? "Season pass holder" : "Frequent buyer"} with ${p.lifetimeTickets ?? "?"} lifetime tickets, ${sold}% of the section is sold. A discount would give away revenue from a loyal fan; a reminder (and a call) is enough.`,
      flags,
    };
  }

  // 2. High demand: seats will sell at full price. Never discount.
  if (sold >= CONFIG.highDemandSoldPct) {
    return {
      offer: "reminder_only",
      discountPct: 0,
      channel,
      reason: `Section is ${sold}% sold with the match in ${days} days. These seats will sell at full price, so a discount would lose revenue. Reminder only.`,
      flags,
    };
  }

  // 3. Low demand + time to act: a capped discount can fill seats that would stay empty.
  const lapsed = p.daysSinceLastPurchase !== null && p.daysSinceLastPurchase >= 180;
  if (sold < CONFIG.lowDemandSoldPct && days >= CONFIG.minDaysForDiscount && (p.neverPurchased || lapsed)) {
    return {
      offer: "promo_code",
      discountPct: Math.min(CONFIG.newFanDiscountPct, CONFIG.maxDiscountPct),
      channel,
      reason: `Section is only ${sold}% sold with ${days} days to go, and this is a ${p.neverPurchased ? "first-time buyer" : "lapsed fan"}. A ${CONFIG.newFanDiscountPct}% single-use code fills seats that would likely stay empty and can win a new regular.`,
      flags,
    };
  }

  // 4. Shop buyers in a mid-demand section: add value without cutting ticket price.
  if ((p.shopSpend12mo ?? 0) >= 100 && sold < CONFIG.highDemandSoldPct) {
    return {
      offer: "merch_addon",
      discountPct: 0,
      channel,
      reason: `Active shop buyer ($${p.shopSpend12mo} in 12 months) and the section is ${sold}% sold. A merch add-on adds value without discounting the ticket.`,
      flags,
    };
  }

  // 5. Default: a simple nudge.
  return {
    offer: "reminder_only",
    discountPct: 0,
    channel,
    reason: `Section is ${sold}% sold with ${days} days to go. No strong case for a discount; a reminder is the low-risk option.`,
    flags,
  };
}
