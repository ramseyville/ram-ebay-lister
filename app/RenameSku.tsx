"use client";

// Standalone SKU-rename tool. Doesn't depend on any batch being loaded —
// works for any SKU already live on eBay, since the server rebuilds the
// listing directly from eBay's own data rather than needing it in the
// app's current session. Built specifically because eBay's Inventory API
// has no "rename SKU" call (SKU is the resource identifier itself), so a
// rename is really "publish under the new SKU, retire the old one" — and
// that used to only work while the item was still loaded in the app.

import { useState } from "react";
import { apiPost } from "@/lib/api-client";

interface ChangeSkuResult {
  success: boolean;
  sku?: string;
  listingId?: string;
  warning?: string;
  error?: string;
}

export function RenameSku() {
  const [open, setOpen] = useState(false);
  const [oldSku, setOldSku] = useState("");
  const [newSku, setNewSku] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ChangeSkuResult | null>(null);

  const canSubmit = oldSku.trim() && newSku.trim() && oldSku.trim() !== newSku.trim() && !busy;

  async function handleSubmit() {
    setBusy(true);
    setResult(null);
    try {
      const res = await apiPost("/api/ebay/change-sku", {
        oldSku: oldSku.trim(),
        sku: newSku.trim(),
      });
      const data = (await res.json()) as ChangeSkuResult;
      setResult(data);
      if (data.success) {
        setOldSku("");
        setNewSku("");
      }
    } catch (e) {
      setResult({ success: false, error: (e as Error).message || "Request failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rename-sku">
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => setOpen((v) => !v)}
      >
        🔀 Rename a SKU already on eBay
      </button>
      {open && (
        <div className="rename-sku-panel">
          <p className="rename-sku-hint">
            Works for any SKU currently live on eBay — no need for the item to
            still be loaded in this app.
          </p>
          <div className="rename-sku-fields">
            <input
              type="text"
              placeholder="Current SKU"
              value={oldSku}
              onChange={(e) => setOldSku(e.target.value)}
              disabled={busy}
            />
            <span aria-hidden="true">→</span>
            <input
              type="text"
              placeholder="New SKU"
              value={newSku}
              onChange={(e) => setNewSku(e.target.value)}
              disabled={busy}
            />
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSubmit}
              disabled={!canSubmit}
            >
              {busy ? "Renaming…" : "Rename"}
            </button>
          </div>
          {result && (
            <div className={result.success ? "rename-sku-success" : "rename-sku-error"}>
              {result.success
                ? `✅ Renamed to "${result.sku}".${result.warning ? ` ${result.warning}` : ""}`
                : `⚠️ ${result.error}`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
