"use client";

// Listing Doctor — bulk mode. Works through every active listing using a
// queue in the database, so each visit carries on where the last one stopped:
//   1. Scan: read each listing and plan its free (rule-based) fixes.
//   2. AI descriptions: overnight Message Batch at half price.
//   3. Review, then apply — each listing backed up first, with Undo.

import { useEffect, useRef, useState } from "react";
import { apiPost } from "@/lib/api-client";

type Status = "new" | "read" | "queued" | "ready" | "nochange" | "skipped" | "applying" | "applied" | "error" | "ended";

interface Counts {
  counts: Partial<Record<Status, number>>;
  aiCost: number;
}

interface Batch {
  id: string;
  status: string;
  done: number;
  total: number;
}

interface Row {
  item_id: string;
  sku: string;
  title: string;
  status: Status;
  item: { description: string; price: number; url: string; conditionName: string } | null;
  proposal: { title: string; description: string; price: number; changes: string[]; needsRewrite: string[] } | null;
  ai_description: string | null;
  ai_cost: number | null;
  error: string | null;
}

const LABEL: Record<Status, string> = {
  new: "Not scanned yet",
  read: "Waiting for AI description",
  queued: "AI description in progress",
  ready: "Ready to apply",
  nochange: "Nothing to fix",
  skipped: "Skipped",
  applying: "Applying now",
  applied: "Applied",
  error: "Problem",
  ended: "Sold / ended",
};

const REVIEW_TABS: Status[] = ["ready", "skipped", "applied", "error", "nochange"];

function Frame({ html }: { html: string }) {
  return <iframe className="doc-frame" sandbox="" srcDoc={html} title="description" />;
}

function Card({ row, onAction, busy }: { row: Row; onAction: (action: string, itemId: string) => void; busy: boolean }) {
  const [tab, setTab] = useState<"old" | "new">("new");
  const { item, proposal } = row;
  const newDescription = row.ai_description || proposal?.description || "";
  return (
    <div className="doc-card">
      <div className="doc-head">
        <strong>{row.sku || "(no SKU)"}</strong>{" "}
        {item?.url ? (
          <a href={item.url} target="_blank" rel="noopener noreferrer">#{row.item_id}</a>
        ) : (
          <span>#{row.item_id}</span>
        )}
        <span className="doc-meta"> · {row.title}</span>
        <span className="doc-status">{LABEL[row.status]}</span>
      </div>
      {row.error && <p className="pricing-error">⚠️ {row.error}</p>}
      <div className="doc-apply">
        {row.status === "ready" && (
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onAction("skip", row.item_id)}>Skip this one</button>
        )}
        {row.status === "skipped" && (
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onAction("unskip", row.item_id)}>Put back in Ready</button>
        )}
        {row.status === "applied" && (
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onAction("undo", row.item_id)}>Undo (restore backup)</button>
        )}
        {row.ai_cost !== null && <span className="doc-meta">AI description cost {(row.ai_cost * 100).toFixed(2)}¢</span>}
      </div>
      {item && proposal && (
        <>
          <table className="doc-table">
            <tbody>
              <tr><th>Title now</th><td>{row.title}</td></tr>
              {proposal.title !== row.title && <tr><th>New title</th><td>{proposal.title} <em>({proposal.title.length})</em></td></tr>}
              {proposal.price !== item.price && <tr><th>Price</th><td>${item.price.toFixed(2)} → ${proposal.price.toFixed(2)}</td></tr>}
            </tbody>
          </table>
          {(proposal.changes.length > 0 || row.ai_description) && (
            <div className="doc-list">
              <strong>Changes:</strong>
              <ul>
                {proposal.changes.map((c) => <li key={c}>{c}</li>)}
                {row.ai_description && <li>New AI-written description</li>}
              </ul>
            </div>
          )}
          {proposal.needsRewrite.length > 0 && !row.ai_description && (
            <div className="doc-list"><strong>Not fixed by this pass:</strong> <ul>{proposal.needsRewrite.map((c) => <li key={c}>{c}</li>)}</ul></div>
          )}
          <div className="doc-tabs">
            <button type="button" className={tab === "old" ? "on" : ""} onClick={() => setTab("old")}>Description now</button>
            <button type="button" className={tab === "new" ? "on" : ""} onClick={() => setTab("new")}>New description</button>
          </div>
          <Frame html={tab === "old" ? item.description : newDescription} />
        </>
      )}
    </div>
  );
}

export default function BulkDoctorPage() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [scope, setScope] = useState<"flagged" | "all">("flagged");
  const [tab, setTab] = useState<Status>("ready");
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const stop = useRef(false);

  const n = (s: Status) => counts?.counts[s] || 0;
  const total = counts ? Object.entries(counts.counts).reduce((a, [s, v]) => (s === "ended" ? a : a + (v || 0)), 0) : 0;

  async function call(body: Record<string, unknown>) {
    const res = await apiPost("/api/doctor/bulk", body);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Something went wrong.");
    setCounts({ counts: data.counts, aiCost: data.aiCost });
    if (data.batches) setBatches(data.batches);
    return data;
  }

  async function loadPage(status = tab, off = offset) {
    const data = await call({ action: "page", status, offset: off });
    setRows(data.rows);
  }

  /** Run one action, or keep repeating it while `again` says there's more. */
  async function run(label: string, body: Record<string, unknown>, again?: (d: any) => boolean) {
    setBusy(label);
    setError("");
    stop.current = false;
    try {
      let data = await call(body);
      while (again && again(data) && !stop.current) data = await call(body);
      if (stop.current) setNote("Stopped. Pick up again any time — nothing is lost.");
      await loadPage();
      return data;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    loadPage("ready", 0).catch((e) => setError((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function scan() {
    setNote("Getting your full list of active listings from eBay…");
    const synced = await run("scan", { action: "sync" });
    if (!synced || stop.current) return;
    setNote(`Found ${synced.listed} active listings. Reading the ones not scanned yet…`);
    await run("scan", { action: "read" }, (d) => d.processed > 0 && (d.counts.new || 0) > 0);
    setNote((s) => (s.startsWith("Stopped") ? s : "Scan finished."));
  }

  async function submit() {
    const d = await run("submit", { action: "submit", scope, model: "haiku" }, (x) => x.submitted > 0);
    if (d) setNote("Sent to the overnight batch. Come back later and click “Check for finished descriptions” — usually within an hour, always within 24.");
  }

  async function apply(count: number) {
    const ready = n("ready");
    const howMany = Math.min(count, ready);
    if (!howMany) return;
    if (!window.confirm(`Apply ${howMany} listing${howMany === 1 ? "" : "s"} to eBay now? Each one is backed up first and can be undone.`)) return;
    let left = howMany;
    await run("apply", { action: "apply", count: Math.min(left, 500) }, (d) => {
      left -= d.processed;
      return d.processed > 0 && left > 0 && (d.counts.ready || 0) > 0;
    });
  }

  async function rowAction(action: string, itemId: string) {
    if (action === "undo" && !window.confirm("Restore this listing exactly as it was before the Doctor changed it?")) return;
    await run(action, { action, itemId });
  }

  const awaitingAi = scope === "all" ? n("read") + n("ready") + n("nochange") : n("read");

  return (
    <main className="wrap">
      <header className="masthead">
        <span className="logo-mark" aria-hidden="true">🩺</span>
        <div>
          <h1>Listing Doctor — whole store</h1>
          <p>
            Works through every listing and remembers where it stopped. Nothing changes on eBay until you click Apply, and every change is
            backed up and can be undone. <a href="/doctor">← 20-at-a-time Doctor</a>
          </p>
        </div>
      </header>

      {counts && (
        <section className="doc-controls">
          {(Object.keys(LABEL) as Status[]).filter((s) => n(s)).map((s) => (
            <span key={s} className="doc-meta">{LABEL[s]}: <strong>{n(s)}</strong> ·</span>
          ))}
          <span className="doc-meta">AI spent so far: ${counts.aiCost.toFixed(2)}</span>
        </section>
      )}

      <section className="doc-card">
        <h2>1 · Scan my store (free)</h2>
        <p className="doc-meta">
          Reads each listing and plans the free fixes. {total ? `${total - n("new")} of ${total} scanned.` : ""} Uses one eBay call per
          listing; eBay allows a few thousand a day, so a big store may take two days — just click again tomorrow.
        </p>
        <div className="doc-controls">
          <button type="button" className="btn btn-primary" onClick={scan} disabled={!!busy}>
            {busy === "scan" ? "Scanning…" : n("new") || !total ? "Scan (continue where it stopped)" : "Re-check for new listings"}
          </button>
        </div>
      </section>

      <section className="doc-card">
        <h2>2 · AI descriptions — overnight, half price</h2>
        <p className="doc-meta">
          Uses the cheapest model from your cost test, sent as one overnight batch, which costs half the normal price.
        </p>
        <div className="doc-controls">
          <label className="doc-meta">
            Rewrite:{" "}
            <select value={scope} onChange={(e) => setScope(e.target.value as "flagged" | "all")}>
              <option value="flagged">Only listings with a description problem</option>
              <option value="all">Every scanned listing</option>
            </select>
          </label>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={!!busy || !awaitingAi}>
            {busy === "submit" ? "Sending…" : `Send ${awaitingAi} to the overnight batch`}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => run("collect", { action: "collect" })} disabled={!!busy || !n("queued")}>
            {busy === "collect" ? "Checking…" : "Check for finished descriptions"}
          </button>
        </div>
        {batches.map((b) => (
          <p key={b.id} className="doc-meta">
            Batch {b.id.slice(-6)}: {b.status === "ended" ? "finished" : "in progress"} — {b.done} of {b.total}
          </p>
        ))}
      </section>

      <section className="doc-card">
        <h2>3 · Review and apply</h2>
        <p className="doc-meta">
          Look through the Ready list and skip anything you don't want. Try a small batch first, then apply the rest.
        </p>
        <div className="doc-controls">
          <button type="button" className="btn btn-secondary" onClick={() => apply(10)} disabled={!!busy || !n("ready")}>
            Apply next 10
          </button>
          <button type="button" className="btn btn-primary" onClick={() => apply(n("ready"))} disabled={!!busy || !n("ready")}>
            {busy === "apply" ? "Applying…" : `Apply all ${n("ready")} ready`}
          </button>
          {n("error") > 0 && (
            <button type="button" className="btn btn-ghost" onClick={() => run("retry", { action: "retry" })} disabled={!!busy}>
              Retry {n("error")} with problems
            </button>
          )}
        </div>
      </section>

      {busy && (
        <section className="doc-controls">
          <span className="doc-meta">Working… {note}</span>
          <button type="button" className="btn btn-ghost" onClick={() => (stop.current = true)}>Stop after this step</button>
        </section>
      )}
      {!busy && note && <p className="doc-meta">{note}</p>}
      {error && <p className="pricing-error">⚠️ {error}</p>}

      <div className="doc-tabs">
        {REVIEW_TABS.map((s) => (
          <button
            key={s}
            type="button"
            className={tab === s ? "on" : ""}
            disabled={!!busy}
            onClick={() => {
              setTab(s);
              setOffset(0);
              loadPage(s, 0).catch((e) => setError((e as Error).message));
            }}
          >
            {LABEL[s]} ({n(s)})
          </button>
        ))}
      </div>
      {rows.map((row) => (
        <Card key={row.item_id} row={row} busy={!!busy} onAction={rowAction} />
      ))}
      {(offset > 0 || rows.length === 10) && (
        <div className="doc-controls">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!!busy || offset === 0}
            onClick={() => {
              const o = Math.max(offset - 10, 0);
              setOffset(o);
              loadPage(tab, o).catch((e) => setError((e as Error).message));
            }}
          >
            ← Previous 10
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!!busy || rows.length < 10}
            onClick={() => {
              const o = offset + 10;
              setOffset(o);
              loadPage(tab, o).catch((e) => setError((e as Error).message));
            }}
          >
            Next 10 →
          </button>
        </div>
      )}
    </main>
  );
}
