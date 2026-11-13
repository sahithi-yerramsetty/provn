# Fan Offer Engine: Cart Win-Back (Envorso Sports)

A proof of concept that looks at stale ticket carts, decides which fans are worth a win-back offer, picks the offer and channel, and puts each one in front of a marketer to **approve, edit or reject**. Nothing reaches a fan without approval.

## Run it

```bash
npm install
npm run dev        # UI → http://localhost:3000
npm test           # 25 engine tests (vitest)
```

Optional: set `ANTHROPIC_API_KEY` to have the model write the message copy. Without it, the engine uses templates (and every test runs without it).
To see a failed send in the UI: `FAIL_DELIVERY=push npm run dev`.

## Project layout

| Path | What it does |
|---|---|
| `src/data/staleCarts.json` | The 8 sample carts, kept exactly as given |
| `src/engine/normalize.ts` | Parses raw strings; "Unknown"/"Not synced" become `null` + a data issue |
| `src/engine/identity.ts` | Links guest checkouts to fan accounts (email match) |
| `src/engine/decide.ts` | **Rules**: channel choice + offer choice |
| `src/engine/message.ts` | **AI**: writes the fan-facing copy only, with a template fallback |
| `src/engine/guardrails.ts` | Hard checks: opt-in, 15% cap, copy matches offer, code placeholder |
| `src/engine/ledger.ts` | "Never send twice" record |
| `src/engine/delivery.ts` | Approve → recheck → claim ledger → issue single-use code → send (stubbed email + push) |
| `src/engine/engine.ts` | The pipeline |
| `src/lib/store.ts`, `src/app/api/*` | API + in-memory state + audit log |
| `src/app/ReviewQueue.tsx` | Marketer UI |
| `tests/engine.test.ts` | Tests for every data trap and guardrail |

---

## Section A: System design

### Pipeline

```
stale carts
  → 1 normalize        (parse; unknowns become null + flagged, never guessed)
  → 2 resolve identity (guest checkout → fan account by email)
  → 3 group            (one decision per fan + match; duplicates merged)
  → 4 eligibility      (team enabled? match in future? data usable? already contacted?)
  → 5 one offer per fan per run
  → 6 decide offer + channel   ← RULES
  → 7 write message copy       ← MODEL (optional, validated, template fallback)
  → 8 guardrail check
  → marketer review (approve / edit / reject)
  → approve: recheck guardrails → claim ledger slot → issue code → send
```

Every cart ends up in exactly one place: a proposal or the "No offer" list with a reason. There's a test for this.

### Rules vs. model

| Decision | Rules or model | Why |
|---|---|---|
| Who gets an offer, how much discount, which channel | **Rules** | Money and consent. Must be exact, the same every run, testable and explainable to a marketer. |
| Fan-facing wording | **Model** | Tone and variety help here, and a bad output is caught by guardrails + a human before sending. |
| Fallback when the model fails or breaks a check | **Template** | Counted and shown in the UI, never silent. |

### Safety: "cannot fail silently"

- **Consent:** channel only from opted-in options. Rechecked after every edit and at send. The UI disables opted-out channels.
- **Never twice:** idempotency key `team:fan:match:trigger`. The ledger slot is claimed *before* the provider call, so a double click or retry can't double-send. Re-runs skip contacted fans.
- **Discount guardrail:** max 15%, single-use code generated only at approval. The copy can't mention a different % than the real offer.
- **Codes expire at kickoff:** a win-back code is useless once the match starts, so checkout (`redeemPromoCode`) rejects it after kickoff, after one use, or for a different fan. Approving an offer after kickoff is blocked and no code is issued.
- **Failures are visible:** blocked edits, blocked approvals and failed sends show on the card, in a banner and in the activity log. Failed sends are **not** auto-retried.

### Monitoring (no ops team, so this is the minimum)

The run summary is shown at the top of the UI. In production, log it daily and alert on:
- a run with 0 carts in (upstream feed broken)
- any `GUARDRAIL:` flag on a generated proposal (rules bug)
- template fallback rate spiking (model problem)
- send failures > 0
- discount rate jumping vs. the last 7 days

### What changes for production

- In-memory store → Postgres tables: `proposals`, `send_ledger` (UNIQUE on key), `promo_codes` (max 1 redemption), `audit_log`.
- Run the engine as a daily scheduled job, not on page load.
- Real match IDs and kickoff times from ticketing instead of parsing "in 4 days" (kickoff is estimated as now + N days in this POC).
- Guest → fan linking via a real email lookup instead of the stubbed map.
- Swap the stub providers for the transactional email API and the app's push service.
- Auth on the marketer UI; per-team access as teams onboard.

---

## Section B: Decisions, scoping and revenue judgment

### What happens to each sample cart

| Cart(s) | Decision | Why |
|---|---|---|
| C-1001 + C-1006 (F-204) | **1** reminder, push | Same fan, same match, two carts → merged. Section 88% sold: seats will sell at full price, so no discount. Latest cart was in the app → push. |
| C-1002 + C-1008 (F-511) | 10% promo code, email | Guest cart C-1008 matches F-511 by email → merged. First-time buyer, section only 41% sold, 18 days out: a capped discount fills seats that would likely stay empty. Push opted out → email. |
| C-1003 (F-092) | Reminder, push | Email opted out → push. Lapsed fan, but section is 88% sold → no discount. |
| C-1004 (F-333) | Reminder, email + **flag for sales** | Season pass holder, 40 tickets, 97% sold. A discount would give away revenue from a loyal fan. Best handled by the salesperson. |
| C-1005 (F-777) | **No offer** | Match already played. |
| C-1007 (F-618) | **No offer** | League team still onboarding, shop data "Not synced". Out of scope for sprint 1. |

### Money impact on every card

Each offer shows **what we collect if the fan buys** and **what the discount gives away**. The top of the page shows the total that would be given away if every pending discount converts. In the sample, the only discount is F-511's 10% code: up to $14 given away to try to sell $140 of seats that are likely to stay empty. Every other offer gives away $0.

### When NOT to discount

- Section ≥ 80% sold: the seats sell anyway.
- Season pass holders / frequent buyers: they're coming back; a discount trains them to wait.
- Match < 7 days away: a reminder is enough; a discount mostly subsidizes people who'd buy anyway.

A discount only happens when the section is under 60% sold, there are 7+ days to go, **and** the fan is new or lapsed. All thresholds are in `src/engine/config.ts`.

### Scope for sprint 1

**In:** Seawolves only, cart win-back trigger, approve/edit/reject, consent + cap + never-twice guardrails, stub delivery, audit log.
**Out (next):** other teams (add to `enabledTeams` once their data syncs), more triggers, real DB, scheduled job, measuring conversion per offer (to tune the thresholds with real data).

---

## Section C: How I used AI

- **Tools used:**
- **How I scoped tasks for the AI (specs, tests as guardrails):**
- **What I rejected or changed on review:**
- **My redirection moment (same one as the video):**