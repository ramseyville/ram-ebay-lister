"use client";

// Listing Doctor — test run. Reads the oldest listings by SKU, shows the free
// rule-based fixes and a full AI rewrite side by side with the AI cost, then
// applies the version chosen per listing — each one backed up to the database
// first, with Undo.

import { useState } from "react";
import { apiPost } from "@/lib/api-client";
import { applyConditionToDescription } from "@/lib/conditions";
import { cleanSpecificValue } from "@/lib/description";
import type { ListingResult } from "@/lib/types";

interface Summary {
  itemId: string;
  sku: string;
  title: string;
}

interface Proposal {
  title: string;
  description: string;
  price: number;
  bestOffer: boolean;
  categoryId: string;
  specifics: Record<string, string[]>;
  conditionText: string;
  changes: string[];
  needsRewrite: string[];
  emptyFields: string[];
}

interface ItemData {
  itemId: string;
  sku: string;
  title: string;
  description: string;
  price: number;
  conditionId: number;
  conditionName: string;
  conditionNotes: string;
  categoryId: string;
  categoryName: string;
  specifics: Record<string, string[]>;
  pictures: string[];
  bestOfferEnabled: boolean;
  startTime: string;
  watchCount: number;
  url: string;
}

interface Rewrite {
  title: string;
  description: string;
  specifics: Record<string, string[]>;
  cost: number;
}

type Choice = "rewrite" | "free" | "skip";

interface Row {
  summary: Summary;
  status: "waiting" | "reading" | "rewriting" | "done" | "error";
  item?: ItemData;
  proposal?: Proposal;
  rewrite?: Rewrite;
  error?: string;
  choice: Choice;
  apply?: "applying" | "applied" | "undoing" | "undone" | "error";
  applyError?: string;
}

// Claude Sonnet 5 list prices (per token) — the rewrite model.
const PRICE = { input: 2 / 1e6, output: 10 / 1e6, cacheRead: 0.2 / 1e6, cacheWrite: 2.5 / 1e6 };

function existingContext(item: ItemData): string {
  const text = item.description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const specs = Object.entries(item.specifics)
    .map(([k, v]) => `${k}: ${v.join(", ")}`)
    .join("; ");
  return [
    `Title: ${item.title}`,
    `eBay condition: ${item.conditionName}${item.conditionNotes ? ` — ${item.conditionNotes}` : ""}`,
    `Category: ${item.categoryName}`,
    `Price: $${item.price.toFixed(2)}`,
    specs ? `Item specifics: ${specs}` : "",
    `Description: ${text.slice(0, 5000)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function Frame({ html }: { html: string }) {
  return <iframe className="doc-frame" sandbox="" srcDoc={html} title="description" />;
}

function Card({
  row,
  onChoice,
  onUndo,
}: {
  row: Row;
  onChoice: (c: Choice) => void;
  onUndo: () => void;
}) {
  const [tab, setTab] = useState<"old" | "fixed" | "rewrite">("rewrite");
  const { item, proposal, rewrite } = row;
  return (
    <div className="doc-card">
      <div className="doc-head">
        <strong>{row.summary.sku || "(no SKU)"}</strong>{" "}
        {item?.url ? (
          <a href={item.url} target="_blank" rel="noopener noreferrer">
            #{row.summary.itemId}
          </a>
        ) : (
          <span>#{row.summary.itemId}</span>
        )}
        {item && (
          <span className="doc-meta">
            {" "}· {item.conditionName} · {item.watchCount} watching · listed {item.startTime.slice(0, 10)}
          </span>
        )}
        <span className={`doc-status ${row.status}`}>{row.status === "done" ? "✓ preview ready" : row.status}</span>
      </div>
      {row.error && <p className="pricing-error">⚠️ {row.error}</p>}
      {proposal && (
        <div className="doc-apply">
          {row.apply === "applied" ? (
            <>
              <span className="doc-status done">✓ Applied to eBay (backed up)</span>
              <button type="button" className="btn btn-ghost" onClick={onUndo}>Undo</button>
            </>
          ) : row.apply === "applying" || row.apply === "undoing" ? (
            <span className="doc-meta">{row.apply === "applying" ? "Backing up and applying…" : "Restoring from backup…"}</span>
          ) : (
            <label className="doc-meta">
              Apply:{" "}
              <select value={row.choice} onChange={(e) => onChoice(e.target.value as Choice)}>
                <option value="rewrite" disabled={!rewrite}>AI rewrite</option>
                <option value="free">Free fixes only</option>
                <option value="skip">Skip</option>
              </select>
              {row.apply === "undone" && <span className="doc-status"> · restored from backup</span>}
            </label>
          )}
          {row.applyError && <p className="pricing-error">⚠️ {row.applyError}</p>}
        </div>
      )}
      {item && proposal && (
        <>
          <table className="doc-table">
            <tbody>
              <tr><th>Title now</th><td>{item.title} <em>({item.title.length})</em></td></tr>
              <tr><th>Free fixes</th><td>{proposal.title} <em>({proposal.title.length})</em></td></tr>
              {rewrite && <tr><th>AI rewrite</th><td>{rewrite.title} <em>({rewrite.title.length})</em></td></tr>}
              <tr><th>Price</th><td>${item.price.toFixed(2)} → ${proposal.price.toFixed(2)}</td></tr>
              <tr><th>Best Offer</th><td>{item.bestOfferEnabled ? "on" : "off → on"} (no auto-accept / decline)</td></tr>
              {proposal.categoryId !== item.categoryId && (
                <tr><th>Category</th><td>{item.categoryId} → {proposal.categoryId}</td></tr>
              )}
            </tbody>
          </table>
          {proposal.changes.length > 0 && (
            <div className="doc-list"><strong>Free fixes:</strong> <ul>{proposal.changes.map((c) => <li key={c}>{c}</li>)}</ul></div>
          )}
          {proposal.needsRewrite.length > 0 && (
            <div className="doc-list"><strong>Needs the AI rewrite:</strong> <ul>{proposal.needsRewrite.map((c) => <li key={c}>{c}</li>)}</ul></div>
          )}
          {rewrite && (
            <details className="doc-list">
              <summary>Item specifics after rewrite ({Object.keys(rewrite.specifics).length} vs {Object.keys(item.specifics).length} now)</summary>
              <table className="doc-table">
                <tbody>
                  {Object.entries(rewrite.specifics).map(([k, v]) => (
                    <tr key={k}>
                      <th>{k}</th>
                      <td>
                        {v.join(", ")}
                        {(item.specifics[k] || []).join(", ") !== v.join(", ") && (
                          <em> (now: {(item.specifics[k] || []).join(", ") || "empty"})</em>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
          <div className="doc-tabs">
            <button type="button" className={tab === "old" ? "on" : ""} onClick={() => setTab("old")}>Description now</button>
            <button type="button" className={tab === "fixed" ? "on" : ""} onClick={() => setTab("fixed")}>Free fixes</button>
            <button type="button" className={tab === "rewrite" ? "on" : ""} onClick={() => setTab("rewrite")} disabled={!rewrite}>AI rewrite</button>
          </div>
          <Frame html={tab === "old" ? item.description : tab === "fixed" ? proposal.description : rewrite?.description || ""} />
        </>
      )}
    </div>
  );
}

export default function DoctorPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const update = (itemId: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.summary.itemId === itemId ? { ...r, ...patch } : r)));

  async function loadOldest() {
    setBusy(true);
    setError("");
    try {
      const res = await apiPost("/api/doctor/list", { count: 20 });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Couldn't read your listings.");
      setTotal(data.total);
      setRows((data.items as Summary[]).map((summary) => ({ summary, status: "waiting", choice: "rewrite" })));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function previewOne(row: Row) {
    const id = row.summary.itemId;
    try {
      update(id, { status: "reading", error: undefined });
      const res = await apiPost("/api/doctor/item", { itemId: id });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Couldn't read this listing.");
      const item = data.item as ItemData;
      const proposal = data.proposal as Proposal;
      update(id, { item, proposal, status: "rewriting", ...(data.applied ? { apply: "applied" as const } : {}) });
      // Already changed by the Doctor — don't spend on a fresh rewrite.
      if (data.applied) {
        update(id, { status: "done", choice: "skip" });
        return;
      }

      if (!item.pictures.length) throw new Error("This listing has no photos to rewrite from.");
      const aRes = await apiPost("/api/analyze", {
        images: [],
        imageUrls: item.pictures.slice(0, 5),
        existing: existingContext(item),
        profile: "auto",
      });
      const aData = await aRes.json();
      if (!aData.ok) throw new Error(aData.error || "AI rewrite failed.");
      const listing = aData.listing as ListingResult;
      const specifics: Record<string, string[]> = { ...proposal.specifics };
      for (const [k, v] of Object.entries(listing.item_specifics || {})) {
        const val = cleanSpecificValue(String(v || ""));
        if (val) specifics[k] = [val];
      }
      const u = aData.usage || {};
      const cost =
        (u.input_tokens || 0) * PRICE.input +
        (u.output_tokens || 0) * PRICE.output +
        (u.cache_read_input_tokens || 0) * PRICE.cacheRead +
        (u.cache_creation_input_tokens || 0) * PRICE.cacheWrite;
      update(id, {
        status: "done",
        rewrite: {
          title: listing.title,
          // The listing's real eBay condition, not the model's re-grade.
          description: applyConditionToDescription(listing.description, proposal.conditionText),
          specifics,
          cost,
        },
      });
    } catch (e) {
      update(id, { status: "error", error: (e as Error).message });
    }
  }

  async function previewAll() {
    setBusy(true);
    const queue = rows.filter((r) => r.status !== "done");
    // Three at a time: each rewrite takes a minute or two.
    const workers = Array.from({ length: 3 }, async () => {
      while (queue.length) {
        const next = queue.shift();
        if (next) await previewOne(next);
      }
    });
    await Promise.all(workers);
    setBusy(false);
  }

  function versionFor(row: Row) {
    const p = row.proposal!;
    const r = row.choice === "rewrite" ? row.rewrite : undefined;
    return {
      title: r ? r.title : p.title,
      description: r ? r.description : p.description,
      price: p.price,
      categoryId: p.categoryId,
      specifics: r ? r.specifics : p.specifics,
    };
  }

  async function applyApproved() {
    const ready = rows.filter(
      (r) => r.proposal && r.choice !== "skip" && r.apply !== "applied" && (r.choice === "free" || r.rewrite)
    );
    if (!ready.length) return;
    if (
      !window.confirm(
        `Apply ${ready.length} listing${ready.length === 1 ? "" : "s"} to eBay now? Each one is backed up to the database first and can be undone.`
      )
    )
      return;
    setBusy(true);
    for (const row of ready) {
      const id = row.summary.itemId;
      update(id, { apply: "applying", applyError: undefined });
      try {
        const res = await apiPost("/api/doctor/apply", { itemId: id, version: versionFor(row) });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "eBay didn't accept the change.");
        update(id, { apply: "applied" });
      } catch (e) {
        update(id, { apply: "error", applyError: (e as Error).message });
      }
    }
    setBusy(false);
  }

  async function undo(itemId: string) {
    if (!window.confirm("Restore this listing exactly as it was before the Doctor changed it?")) return;
    update(itemId, { apply: "undoing", applyError: undefined });
    try {
      const res = await apiPost("/api/doctor/undo", { itemId });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Undo failed.");
      update(itemId, { apply: "undone" });
    } catch (e) {
      update(itemId, { apply: "applied", applyError: (e as Error).message });
    }
  }

  const done = rows.filter((r) => r.rewrite);
  const approved = rows.filter(
    (r) => r.proposal && r.choice !== "skip" && r.apply !== "applied" && (r.choice === "free" || r.rewrite)
  ).length;
  const cost = done.reduce((s, r) => s + (r.rewrite?.cost || 0), 0);

  return (
    <main className="wrap">
      <header className="masthead">
        <span className="logo-mark" aria-hidden="true">🩺</span>
        <div>
          <h1>Listing Doctor — test run</h1>
          <p>Nothing changes on eBay until you click Apply — and every change is backed up and can be undone. <a href="/">← Back to Listing Writer</a> · <a href="/doctor/describe-test">🧪 Description cost test</a></p>
        </div>
      </header>

      <section className="doc-controls">
        <button type="button" className="btn btn-primary" onClick={loadOldest} disabled={busy}>
          1 · Find my 20 oldest listings (lowest SKUs)
        </button>
        <button type="button" className="btn btn-secondary" onClick={previewAll} disabled={busy || !rows.length}>
          2 · Preview fixes + AI rewrites
        </button>
        <button type="button" className="btn btn-primary" onClick={applyApproved} disabled={busy || !approved}>
          3 · Apply {approved || ""} approved to eBay
        </button>
        {total !== null && <span className="doc-meta">{total} active listings in your store.</span>}
        {done.length > 0 && (
          <span className="doc-meta">
            {done.length} rewrites · AI cost ≈ ${cost.toFixed(2)} (≈ ${(cost / done.length).toFixed(3)} each, plus web searches at ~1¢ each)
          </span>
        )}
        {error && <p className="pricing-error">⚠️ {error}</p>}
      </section>

      {rows.map((row) => (
        <Card
          key={row.summary.itemId}
          row={row}
          onChoice={(choice) => update(row.summary.itemId, { choice })}
          onUndo={() => undo(row.summary.itemId)}
        />
      ))}
    </main>
  );
}
