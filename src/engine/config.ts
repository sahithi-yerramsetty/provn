// All business knobs live here so a marketer/engineer can tune without touching logic.

export const CONFIG = {
  // Sprint 1 ships for the Seawolves only. Other teams get added here as they onboard
  // AND once their data (e.g. shop spend) is synced.
  enabledTeams: ["Seawolves"],

  // Give fans a little time to come back on their own before we nudge.
  minHoursSinceAbandon: 1,

  // Carts older than this are too stale to act on.
  maxHoursSinceAbandon: 7 * 24,

  // Yield rules: when to protect price vs. when a discount earns revenue.
  highDemandSoldPct: 80, // at/above this, never discount (seats will sell anyway)
  lowDemandSoldPct: 60, // below this, a discount can fill otherwise-empty seats
  minDaysForDiscount: 7, // discounts need time to work; close to match = reminder

  // Offer guardrails (from the brief): single-use, max 15%.
  maxDiscountPct: 15,
  newFanDiscountPct: 10,

  // High-value fans go to the salesperson, not an automated discount.
  vipLifetimeTickets: 20,
} as const;
