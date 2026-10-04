"use client";

// Listing Doctor — description-only cost test. Rewrites the descriptions of
// the next 10 oldest listings with two models, shows them side by side with
// the MEASURED cost of each, and projects the cost for the whole store.
// Read-only: nothing is written to eBay.

import { useState } from "react";
import { apiPost } from "@/lib/api-client";

type ModelKey = "sonnet" | "haiku";
const MODEL_LABEL: Record<ModelKey, string> = { sonnet: "Current model", haiku: "Cheapest model" };

interface Result {
  description?: string;
  cost?: number;
  error?: string;
}

interface Row {
  itemId: string;
  sku: string;
  title: string;
  url?: string;
  oldDescription?: string;
  status: string;
  results: Partial<Record<ModelKey, Result>>;
}

function Frame({ html }: { html: string }) {
  return <iframe className="doc-frame" sandbox="" srcDoc={html} title="description" />;
}

function Card({ row }: { row: Row }) {
  const [tab, setTab] = useState<"old" | ModelKey>("haiku");
  const html = tab === "old" ? row.oldDescription || "" : row.results[tab]?.description || "";
  return (
    <div className="doc-card">
      <div className="doc-head">
        <strong>{row.sku || "(no SKU)"}</strong>{" "}
        {row.url ? (
          <a href={row.url} target="_blank" rel="noopener noreferrer">#{row.itemId}</a>
        ) : (
          <span>#{row.itemId}</span>
        )}
        <span className="doc-meta"> · {row.title}</span>
        <span className="doc-status">{row.status}</span>
      </div>
      <div className="doc-tabs">
        <button type="button" className={tab === "old" ? "on" : ""} onClick={() => setTab("old")}>Description now</button>
        {(["sonnet", "haiku"] as ModelKey[]).map((m) => (
          <button key={m} type="button" className={tab === m ? "on" : ""} onClick={() => setTab(m)} disabled={!row.results[m]?.description}>
            {MODEL_LABEL[m]}
            {row.results[m]?.cost !== undefined ? ` · $${row.results[m]!.cost!.toFixed(4)}` : ""}
          </button>
        ))}
      </div>
      {(["sonnet", "haiku"] as ModelKey[]).map((m) =>
        row.results[m]?.error ? <p key={m} className="pricing-error">⚠️ {MODEL_LABEL[m]}: {row.results[m]!.error}</p> : null
      )}
      <Frame html={html} />
    </div>
  );
}

export default function DescribeTestPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const update = (itemId: string, patch: (r: Row) => Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.itemId === itemId ? { ...r, ...patch(r) } : r)));

  async function runTest() {
    setBusy(true);
    setError("");
    try {
      const res = await apiPost("/api/doctor/list", { count: 10, offset: 20 });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Couldn't read your listings.");
      setTotal(data.total);
      const list: Row[] = (data.items as { itemId: string; sku: string; title: string }[]).map((s) => ({
        ...s,
        status: "waiting",
        results: {},
      }));
      setRows(list);

      const queue = [...list];
      const workers = Array.from({ length: 3 }, async () => {
        while (queue.length) {
          const row = queue.shift();
          if (!row) continue;
          const id = row.itemId;
          try {
            update(id, () => ({ status: "reading" }));
            const iRes = await apiPost("/api/doctor/item", { itemId: id });
            const iData = await iRes.json();
            if (!iData.ok) throw new Error(iData.error || "Couldn't read this listing.");
            update(id, () => ({ status: "writing", url: iData.item.url, oldDescription: iData.item.description }));
            await Promise.all(
              (["sonnet", "haiku"] as ModelKey[]).map(async (m) => {
                const dRes = await apiPost("/api/doctor/describe", {
                  model: m,
                  item: iData.item,
                  conditionText: iData.proposal.conditionText,
                });
                const d = await dRes.json();
                update(id, (r) => ({
                  results: { ...r.results, [m]: d.ok ? { description: d.description, cost: d.cost } : { error: d.error } },
                }));
              })
            );
            update(id, () => ({ status: "✓ done" }));
          } catch (e) {
            update(id, () => ({ status: `error: ${(e as Error).message}` }));
          }
        }
      });
      await Promise.all(workers);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const summary = (["sonnet", "haiku"] as ModelKey[]).map((m) => {
    const costs = rows.map((r) => r.results[m]?.cost).filter((c): c is number => typeof c === "number");
    const avg = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : 0;
    const store = total ?? 0;
    return { m, n: costs.length, sum: costs.reduce((a, b) => a + b, 0), avg, store: avg * store, batch: (avg * store) / 2 };
  });

  return (
    <main className="wrap">
      <header className="masthead">
        <span className="logo-mark" aria-hidden="true">🧪</span>
        <div>
          <h1>Description rewrite — cost test</h1>
          <p>
            Rewrites the descriptions of your next 10 oldest listings (21–30) with two AI models and shows the real cost.
            Nothing is changed on eBay. <a href="/doctor">← Listing Doctor</a>
          </p>
        </div>
      </header>

      <section className="doc-controls">
        <button type="button" className="btn btn-primary" onClick={runTest} disabled={busy}>
          {busy ? "Running…" : "Run the 10-listing description test"}
        </button>
        {error && <p className="pricing-error">⚠️ {error}</p>}
      </section>

      {summary.some((s) => s.n) && (
        <table className="doc-table">
          <thead>
            <tr><th>Model</th><th>Rewrites</th><th>Test cost</th><th>Per listing</th><th>All {total} listings</th><th>Overnight (½ price)</th></tr>
          </thead>
          <tbody>
            {summary.map((s) => (
              <tr key={s.m}>
                <th>{MODEL_LABEL[s.m]}</th>
                <td>{s.n}</td>
                <td>${s.sum.toFixed(3)}</td>
                <td>{(s.avg * 100).toFixed(2)}¢</td>
                <td>${s.store.toFixed(0)}</td>
                <td>${s.batch.toFixed(0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {rows.map((row) => (
        <Card key={row.itemId} row={row} />
      ))}
    </main>
  );
}
