// ---------- Input ----------

// Raw row exactly as it arrives. Strings are kept on purpose:
// the real data has "Unknown", "Not synced", "Never", guest IDs, etc.
export interface RawCart {
  cartId: string;
  fanId: string;
  team: string;
  source: string;
  match: string;
  seats: number;
  section: string;
  sectionSoldPct: string;
  cartValue: string;
  abandoned: string;
  lifetimeTickets: string;
  lastPurchase: string;
  shopSpend12mo: string;
  seasonPass: string;
  emailOptIn: string;
  pushOptIn: string;
  note?: string;
}

// ---------- Normalized ----------

export interface Cart {
  cartId: string;
  rawFanId: string;
  fanId: string | null; // null = guest we could not link
  linkedFrom?: string; // e.g. "guest email match"
  team: string;
  source: "web" | "app";
  matchKey: string; // stable id for "this fan + this match"
  matchLabel: string;
  daysUntilMatch: number | null; // negative = already played
  seats: number;
  section: string;
  sectionSoldPct: number | null;
  cartValue: number | null;
  hoursSinceAbandon: number | null;
  lifetimeTickets: number | null;
  daysSinceLastPurchase: number | null; // null = never / unknown
  neverPurchased: boolean;
  shopSpend12mo: number | null;
  seasonPass: boolean;
  emailOptIn: boolean;
  pushOptIn: boolean;
  dataIssues: string[]; // fields we could not trust
}

// ---------- Output ----------

export type OfferType =
  | "promo_code"
  | "match_pass"
  | "season_pass"
  | "merch_addon"
  | "seat_upgrade"
  | "reminder_only";

export type Channel = "email" | "push";

export type ProposalStatus = "pending" | "approved" | "rejected" | "sent" | "failed";

export interface Proposal {
  id: string; // idempotency key: team:fan:match:trigger
  fanId: string;
  team: string;
  cartIds: string[];
  matchLabel: string;
  section: string;
  seats: number;
  cartValue: number | null;
  offer: OfferType;
  discountPct: number; // 0 unless promo_code. Hard cap 15.
  promoCode?: string; // single-use, generated at send time
  channel: Channel;
  optIns: { email: boolean; push: boolean }; // re-checked at send time
  reason: string; // why this fan + this offer (for the marketer)
  message: string; // fan-facing copy (editable)
  messageSource: "ai" | "template";
  flags: string[]; // things the marketer should know
  status: ProposalStatus;
  editedBy?: string;
  error?: string;
}

export type SkipCategory =
  | "match_passed"
  | "team_not_enabled"
  | "no_contact_channel"
  | "duplicate"
  | "already_contacted"
  | "unlinked_guest"
  | "too_recent"
  | "bad_data";

// Carts with NO offer still get a visible reason. Nothing disappears silently.
export interface Skipped {
  cartIds: string[];
  fanId: string | null;
  category: SkipCategory;
  reason: string;
}

export interface RunSummary {
  cartsIn: number;
  proposals: number;
  skipped: number;
  discounted: number;
  aiMessages: number;
  templateFallbacks: number;
}

export interface EngineResult {
  proposals: Proposal[];
  skipped: Skipped[];
  summary: RunSummary;
}
