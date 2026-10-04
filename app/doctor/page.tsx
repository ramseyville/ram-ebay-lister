"use client";

// Listing Doctor — test run (preview only). Reads the oldest listings by SKU,
// shows the free rule-based fixes and a full AI rewrite side by side, and
// estimates the rewrite cost. Nothing here writes to eBay.

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

interface Row {
  summary: Summary;
  status: "waiting" | "reading" | "rewriting" | "done" | "error";
  item?: ItemData;
  proposal?: Proposal;
  rewrite?: Rewrite;
  error?: string;
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

function Card({ row }: { row: Row }) {
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
      setRows((data.items as Summary[]).map((summary) => ({ summary, status: "waiting" })));
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
      update(id, { item, proposal, status: "rewriting" });

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

  const done = rows.filter((r) => r.rewrite);
  const cost = done.reduce((s, r) => s + (r.rewrite?.cost || 0), 0);

  return (
    <main className="wrap">
      <header className="masthead">
        <span className="logo-mark" aria-hidden="true">🩺</span>
        <div>
          <h1>Listing Doctor — test run</h1>
          <p>Preview only: nothing is changed on eBay. <a href="/">← Back to Listing Writer</a></p>
        </div>
      </header>

      <section className="doc-controls">
        <button type="button" className="btn btn-primary" onClick={loadOldest} disabled={busy}>
          1 · Find my 20 oldest listings (lowest SKUs)
        </button>
        <button type="button" className="btn btn-secondary" onClick={previewAll} disabled={busy || !rows.length}>
          2 · Preview fixes + AI rewrites
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
        <Card key={row.summary.itemId} row={row} />
      ))}
    </main>
  );
}
