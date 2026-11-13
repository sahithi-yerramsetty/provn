import type { Cart } from "./types";

// Guest checkouts have no Fan ID. In production we'd look up the checkout email
// in the fan table. The sample gives us that match in the data notes, so we stub
// the lookup with a small map: cartId -> fanId.
export type IdentityLookup = (cart: Cart) => string | null;

export function staticIdentityLookup(links: Record<string, string>): IdentityLookup {
  return (cart) => links[cart.cartId] ?? null;
}

// From the brief: "C-1008 is a guest checkout, its email address matches the account for F-511."
export const SAMPLE_EMAIL_LINKS: Record<string, string> = { "C-1008": "F-511" };

export function resolveIdentity(carts: Cart[], lookup: IdentityLookup): Cart[] {
  return carts.map((c) => {
    if (c.fanId) return c;
    const linked = lookup(c);
    if (!linked) return c;
    // The guest row carries "Unknown" history. Once linked, history comes from
    // the fan's account, so we drop those data issues (the merge step uses the
    // known fan's numbers).
    return { ...c, fanId: linked, linkedFrom: "guest checkout, email matches account", dataIssues: [] };
  });
}
