// Send ledger = the "never send twice" memory.
// POC: in memory. Production: a DB table with a UNIQUE constraint on `key`,
// written in the same transaction that hands the message to the provider.

export interface LedgerEntry {
  key: string; // team:fan:match:trigger
  fanId: string;
  channel: string;
  sentAt: string;
  promoCode?: string;
}

export interface Ledger {
  has(key: string): boolean;
  fanContactedWithinHours(fanId: string, hours: number): boolean;
  record(entry: LedgerEntry): boolean; // false if key already exists
  all(): LedgerEntry[];
}

export function createMemoryLedger(seed: LedgerEntry[] = []): Ledger {
  const byKey = new Map<string, LedgerEntry>(seed.map((e) => [e.key, e]));
  return {
    has: (key) => byKey.has(key),
    fanContactedWithinHours: (fanId, hours) => {
      const cutoff = Date.now() - hours * 3600_000;
      return [...byKey.values()].some((e) => e.fanId === fanId && Date.parse(e.sentAt) >= cutoff);
    },
    record: (entry) => {
      if (byKey.has(entry.key)) return false;
      byKey.set(entry.key, entry);
      return true;
    },
    all: () => [...byKey.values()],
  };
}
