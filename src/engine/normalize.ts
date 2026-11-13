import type { Cart, RawCart } from "./types";

const UNKNOWN = new Set(["unknown", "not synced", "", "n/a"]);

function isUnknown(v: string): boolean {
  return UNKNOWN.has(v.trim().toLowerCase());
}

function parseMoney(v: string): number | null {
  if (isUnknown(v)) return null;
  const n = Number(v.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parsePct(v: string): number | null {
  if (isUnknown(v)) return null;
  const n = Number(v.replace("%", ""));
  return Number.isFinite(n) ? n : null;
}

function parseIntSafe(v: string): number | null {
  if (isUnknown(v)) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function parseHoursAgo(v: string): number | null {
  const m = v.match(/(\d+)\s*hrs?\s*ago/i);
  return m ? Number(m[1]) : null;
}

function parseDaysAgo(v: string): number | null {
  const m = v.match(/(\d+)\s*days?\s*ago/i);
  return m ? Number(m[1]) : null;
}

function parseYesNo(v: string): boolean {
  return v.trim().toLowerCase() === "yes";
}

// "Next home match (in 4 days)" -> 4, "Home match (played 2 days ago)" -> -2
function parseDaysUntilMatch(v: string): number | null {
  const ahead = v.match(/in\s+(\d+)\s+days?/i);
  if (ahead) return Number(ahead[1]);
  const played = v.match(/played\s+(\d+)\s+days?\s+ago/i);
  if (played) return -Number(played[1]);
  return null;
}

// In production this would be a real match ID from ticketing. The sample only gives
// a relative label, so we key on team + days-until-match.
function matchKeyFor(team: string, daysUntil: number | null, label: string): string {
  return `${team}|${daysUntil ?? label}`;
}

export function normalize(raw: RawCart): Cart {
  const dataIssues: string[] = [];
  const track = <T,>(field: string, value: T | null, rawValue: string): T | null => {
    if (value === null && rawValue.trim().toLowerCase() !== "never") {
      dataIssues.push(`${field}: "${rawValue}"`);
    }
    return value;
  };

  const isGuest = !/^F-\d+$/.test(raw.fanId.trim());
  const daysUntilMatch = parseDaysUntilMatch(raw.match);
  const neverPurchased = raw.lastPurchase.trim().toLowerCase() === "never";

  return {
    cartId: raw.cartId,
    rawFanId: raw.fanId,
    fanId: isGuest ? null : raw.fanId.trim(),
    team: raw.team,
    source: raw.source.trim().toLowerCase() === "app" ? "app" : "web",
    matchKey: matchKeyFor(raw.team, daysUntilMatch, raw.match),
    matchLabel: raw.match,
    daysUntilMatch: track("match", daysUntilMatch, raw.match),
    seats: raw.seats,
    section: raw.section,
    sectionSoldPct: track("sectionSoldPct", parsePct(raw.sectionSoldPct), raw.sectionSoldPct),
    cartValue: track("cartValue", parseMoney(raw.cartValue), raw.cartValue),
    hoursSinceAbandon: track("abandoned", parseHoursAgo(raw.abandoned), raw.abandoned),
    lifetimeTickets: track("lifetimeTickets", parseIntSafe(raw.lifetimeTickets), raw.lifetimeTickets),
    daysSinceLastPurchase: neverPurchased
      ? null
      : track("lastPurchase", parseDaysAgo(raw.lastPurchase), raw.lastPurchase),
    neverPurchased,
    shopSpend12mo: track("shopSpend12mo", parseMoney(raw.shopSpend12mo), raw.shopSpend12mo),
    seasonPass: parseYesNo(raw.seasonPass),
    emailOptIn: parseYesNo(raw.emailOptIn),
    pushOptIn: parseYesNo(raw.pushOptIn),
    dataIssues,
  };
}
