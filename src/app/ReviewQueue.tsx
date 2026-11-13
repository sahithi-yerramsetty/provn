"use client";

import { useCallback, useEffect, useState } from "react";
import type { EngineResult, Proposal } from "@/engine/types";

type Audit = { at: string; proposalId: string; action: string; detail?: string };
type State = EngineResult & { audit: Audit[] };

const OFFER_LABEL: Record<Proposal["offer"], string> = {
  promo_code: "Promo code",
  match_pass: "Match pass",
  season_pass: "Season pass",
  merch_addon: "Merch add-on",
  seat_upgrade: "Seat upgrade",
  reminder_only: "Reminder only",
};

const SKIP_LABEL: Record<string, string> = {
  match_passed: "Match passed",
  team_not_enabled: "Team not enabled",
  no_contact_channel: "No channel",
  duplicate: "Duplicate",
  already_contacted: "Already contacted",
  unlinked_guest: "Unlinked guest",
  too_recent: "Too recent",
  bad_data: "Bad data",
};

export default function ReviewQueue() {
  const [state, setState] = useState<State | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (method: "GET" | "POST" = "GET") => {
    try {
      const res = await fetch("/api/proposals", { method, cache: "no-store" });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      setState(await res.json());
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // Initial load: subscribe-style, setState only in the async callback.
    let alive = true;
    fetch("/api/proposals", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        return res.json();
      })
      .then((data) => alive && setState(data))
      .catch((e) => alive && setLoadError((e as Error).message));
    return () => {
      alive = false;
    };
  }, []);

  if (loadError) return <main className="wrap"><div className="banner error">Could not load offers: {loadError}</div></main>;
  if (!state) return <main className="wrap">Loading…</main>;

  const s = state.summary;
  const pending = state.proposals.filter((p) => p.status === "pending").length;
  const failed = state.proposals.filter((p) => p.status === "failed").length;

  return (
    <main className="wrap">
      <header className="top">
        <div>
          <h1>Cart win-back offers</h1>
          <p className="muted">Seattle Seawolves · nothing reaches a fan until you approve it</p>
        </div>
        <button className="btn ghost" onClick={() => load("POST")}>Re-run engine</button>
      </header>

      <section className="stats">
        <Stat label="Stale carts" value={s.cartsIn} />
        <Stat label="Offers to review" value={pending} />
        <Stat label="With a discount" value={s.discounted} />
        <Stat
          label="Max given away"
          value={`$${state.proposals.filter((p) => p.status !== "rejected").reduce((t, p) => t + p.economics.discountCost, 0).toFixed(2)}`}
        />
        <Stat label="No offer" value={s.skipped} />
        <Stat label="AI-written copy" value={`${s.aiMessages}/${s.proposals}`} />
      </section>

      {failed > 0 && <div className="banner error">{failed} send(s) failed. Check the provider before retrying.</div>}
      {s.templateFallbacks > 0 && (
        <div className="banner warn">{s.templateFallbacks} message(s) fell back to the template because AI copy failed checks.</div>
      )}

      <h2>Proposed offers</h2>
      {state.proposals.length === 0 && <p className="muted">No offers today.</p>}
      <div className="cards">
        {state.proposals.map((p) => (
          <OfferCard key={p.id} p={p} onState={setState} />
        ))}
      </div>

      <h2>No offer ({state.skipped.length})</h2>
      <table className="skipped">
        <thead>
          <tr><th>Carts</th><th>Fan</th><th>Why</th><th>Reason</th></tr>
        </thead>
        <tbody>
          {state.skipped.map((k) => (
            <tr key={k.cartIds.join()}>
              <td>{k.cartIds.join(", ")}</td>
              <td>{k.fanId ?? "Guest"}</td>
              <td><span className="tag">{SKIP_LABEL[k.category] ?? k.category}</span></td>
              <td>{k.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Activity log</h2>
      {state.audit.length === 0 ? (
        <p className="muted">No actions yet.</p>
      ) : (
        <ul className="audit">
          {state.audit.slice(0, 20).map((a, i) => (
            <li key={i}>
              <span className="muted">{new Date(a.at).toLocaleTimeString()}</span> {a.action} · {a.proposalId}
              {a.detail && <span className="muted"> — {a.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="stat">
      <div className="statValue">{value}</div>
      <div className="muted">{label}</div>
    </div>
  );
}

function OfferCard({ p, onState }: { p: Proposal; onState: (s: State) => void }) {
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState(p.message);
  const [discount, setDiscount] = useState(p.discountPct);
  const [channel, setChannel] = useState(p.channel);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  function startEdit() {
    setMessage(p.message);
    setDiscount(p.discountPct);
    setChannel(p.channel);
    setErrors([]);
    setEditing(true);
  }

  async function send(body: object) {
    setBusy(true);
    setErrors([]);
    try {
      const res = await fetch(`/api/proposals/${encodeURIComponent(p.id)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.state) onState(data.state);
      if (data.errors?.length) setErrors(data.errors);
      return res.ok;
    } catch (e) {
      setErrors([`Network error: ${(e as Error).message}`]);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const locked = p.status !== "pending";

  return (
    <article className={`card status-${p.status}`}>
      <div className="cardHead">
        <div>
          <strong>{p.fanId}</strong> <span className="muted">· {p.cartIds.join(", ")}</span>
          <div className="muted small">{p.matchLabel} · {p.seats} × {p.section} · ${p.cartValue}</div>
        </div>
        <span className={`pill ${p.status}`}>{p.status}</span>
      </div>

      <div className="offerRow">
        <span className="tag strong">{OFFER_LABEL[p.offer]}{p.discountPct > 0 ? ` · ${p.discountPct}% off` : ""}</span>
        <span className="tag">via {p.channel === "push" ? "In-app / push" : "Email"}</span>
        <span className="tag subtle">copy: {p.messageSource}</span>
      </div>

      <p className="reason"><b>Why:</b> {p.reason}</p>

      <div className={`money ${p.economics.discountCost > 0 ? "cost" : "free"}`}>
        <div className="moneyRow">
          <span>If the fan buys: <b>${p.economics.revenueIfConverts.toFixed(2)}</b></span>
          <span>Given away: <b>${p.economics.discountCost.toFixed(2)}</b></span>
        </div>
        <div className="small">{p.economics.note}</div>
        {p.offer === "promo_code" && (
          <div className="small">Code expires at kickoff: {new Date(p.matchStartsAt).toLocaleString()}</div>
        )}
      </div>
      {p.flags.length > 0 && (
        <ul className="flags">{p.flags.map((f) => <li key={f} className={f.startsWith("GUARDRAIL") ? "bad" : ""}>{f}</li>)}</ul>
      )}

      {editing ? (
        <div className="editor">
          <label>Message
            <textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} />
          </label>
          <div className="editRow">
            <label>Discount %
              <input type="number" min={0} max={15} value={discount} onChange={(e) => setDiscount(Number(e.target.value))} />
            </label>
            <label>Channel
              <select value={channel} onChange={(e) => setChannel(e.target.value as Proposal["channel"])}>
                <option value="email" disabled={!p.optIns.email}>Email{!p.optIns.email ? " (opted out)" : ""}</option>
                <option value="push" disabled={!p.optIns.push}>In-app / push{!p.optIns.push ? " (opted out)" : ""}</option>
              </select>
            </label>
          </div>
          <p className="muted small">Max 15% off. Promo messages must include {"{{PROMO_CODE}}"}; a single-use code is created on approval.</p>
          <div className="actions">
            <button className="btn" disabled={busy} onClick={async () => {
              if (await send({ type: "edit", message, discountPct: discount, channel })) setEditing(false);
            }}>Save</button>
            <button className="btn ghost" disabled={busy} onClick={() => { setEditing(false); setErrors([]); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <blockquote className="message">{p.message}</blockquote>
      )}

      {p.promoCode && (
        <p className="small">Code issued: <code>{p.promoCode}</code> (single use, expires at kickoff)</p>
      )}
      {(errors.length > 0 || p.error) && (
        <div className="banner error small">{errors.length ? errors.join(" ") : p.error}</div>
      )}

      {!locked && !editing && (
        <div className="actions">
          <button className="btn approve" disabled={busy} onClick={() => send({ type: "approve" })}>
            {busy ? "Sending…" : "Approve & send"}
          </button>
          <button className="btn ghost" disabled={busy} onClick={startEdit}>Edit</button>
          <button className="btn reject" disabled={busy} onClick={() => send({ type: "reject" })}>Reject</button>
        </div>
      )}
    </article>
  );
}
