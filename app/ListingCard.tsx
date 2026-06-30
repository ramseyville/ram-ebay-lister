"use client";

import { useEffect, useMemo, useState } from "react";
import type { ItemGroup, ListingResult, Photo } from "@/lib/types";
import { formatShipping, estimateShipping } from "@/lib/shipping";
import { apiPost } from "@/lib/api-client";

const TITLE_LIMIT = 80;

// eBay's pre-owned condition tiers, matching the values the model returns.
const CONDITIONS: { value: string; label: string }[] = [
  { value: "NEW_WITH_TAGS",  label: "New with tags" },
  { value: "NEW_NO_TAGS",    label: "New without tags" },
  { value: "EXCELLENT",      label: "Pre-owned · Excellent" },
  { value: "VERY_GOOD",      label: "Pre-owned · Very good" },
  { value: "GOOD",           label: "Pre-owned · Good" },
  { value: "FAIR",           label: "Pre-owned · Fair" },
];

function formatPrice(value: ListingResult["suggested_price"]): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (n === undefined || Number.isNaN(n)) return "$0.00";
  return `$${n.toFixed(2)}`;
}

function priceToInput(value: ListingResult["suggested_price"]): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return n === undefined || Number.isNaN(n) ? "" : String(n);
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <button
      type="button"
      className="btn-ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {copied ? "✓ Copied" : `📋 Copy ${label}`}
    </button>
  );
}

interface ListingCardProps {
  group: ItemGroup;
  photoById: (id: string) => Photo | undefined;
  ebayConnected: boolean;
  onEdit: (groupId: string, patch: Partial<ListingResult>) => void;
  onRetry: (groupId: string) => void;
  onPost: (groupId: string) => void;
  onCostChange: (groupId: string, cost: number) => void;
  onRenameSku: (groupId: string, sku: string) => void;
  onUndoPosted: (groupId: string) => void;
}

export function ListingCard({
  group,
  photoById,
  ebayConnected,
  onEdit,
  onRetry,
  onPost,
  onCostChange,
  onRenameSku,
  onUndoPosted,
}: ListingCardProps) {
  const [open, setOpen] = useState(true);
  const [editingConditionNotes, setEditingConditionNotes] = useState(false);
  const [costInput, setCostInput] = useState(String((group.itemCost ?? 10).toFixed(2)));
  const [pricingOpen, setPricingOpen] = useState(false);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [pricingResult, setPricingResult] = useState<string | null>(null);
  const [pricingError, setPricingError] = useState<string | null>(null);

  async function runPricingAnalysis() {
    if (!listing) return;
    setPricingOpen(true);
    setPricingLoading(true);
    setPricingResult(null);
    setPricingError(null);
    try {
      // Select photos: front shot + last 3 (tags/labels/MSRP usually shot last)
      const allPhotoIds = group.photoIds;
      const selectedIds = Array.from(new Set([
        allPhotoIds[0],                                    // front shot always
        ...allPhotoIds.slice(-3),                          // last 3 = tags/labels/hang tag
      ])).filter(Boolean).slice(0, 4);                     // max 4 photos

      const photos = selectedIds
        .map((id) => photoById(id))
        .filter(Boolean)
        .map((p) => ({ mediaType: p!.mediaType, data: p!.data }));

      const res = await apiPost("/api/pricing", { listing, photos });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Pricing analysis failed.");
      setPricingResult(data.analysis);
    } catch (e) {
      setPricingError((e as Error).message);
    } finally {
      setPricingLoading(false);
    }
  }
  const listing = group.listing;
  const cover = photoById(group.photoIds[0]);

  const specifics = useMemo(() => {
    const entries = Object.entries(listing?.item_specifics ?? {});
    return entries.filter(([k, v]) => v && v.trim() !== "" && !k.startsWith("---"));
  }, [listing?.item_specifics]);

  const titleLen = listing?.title?.length ?? 0;

  // Shipping estimate
  const shippingLine = useMemo(() => {
    if (!listing) return null;
    return formatShipping(listing);
  }, [listing]);

  // Condition notes: seller override takes precedence, falls back to AI-generated
  const displayedConditionNotes =
    listing?.condition_notes_override ?? listing?.condition_notes ?? "";

  return (
    <article className={`listing-card status-${group.status}`}>
      <header className="listing-card-head" onClick={() => setOpen((o) => !o)}>
        {cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="listing-cover" src={cover.previewUrl} alt="" />
        )}
        <div className="listing-card-title">
          <strong>
            {group.sku !== undefined && (
              <input
                type="text"
                className="sku-tag sku-tag-input"
                value={group.sku}
                aria-label="Item SKU / custom label"
                disabled={group.postStatus === "posted"}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => onRenameSku(group.id, e.target.value)}
              />
            )}
            {listing?.title || group.name}
          </strong>
          <span className="listing-card-sub">
            {group.status === "writing" && (
              <>
                <span className="spinner small" aria-hidden="true" /> Writing…
              </>
            )}
            {group.status === "done" && (
              <>✅ {formatPrice(listing?.suggested_price)} · ready</>
            )}
            {group.status === "error" && (
              <span style={{ color: "var(--color-danger)" }}>
                ⚠️ {group.error || "Failed"}
              </span>
            )}
            {group.status === "idle" && "Waiting…"}
          </span>
        </div>
        {group.status === "error" ? (
          <button
            type="button"
            className="btn-ghost"
            onClick={(e) => {
              e.stopPropagation();
              onRetry(group.id);
            }}
          >
            ↻ Retry
          </button>
        ) : (
          <span className="chevron" aria-hidden="true">
            {open ? "▾" : "▸"}
          </span>
        )}
      </header>

      {open && listing && group.status === "done" && (
        <div className="listing-card-body">
          <div className="result-field">
            <label>
              Title
              <span className={`count${titleLen > TITLE_LIMIT ? " over" : ""}`}>
                {titleLen}/{TITLE_LIMIT}
              </span>
            </label>
            <input
              type="text"
              className="title-input"
              value={listing.title}
              onChange={(e) => onEdit(group.id, { title: e.target.value })}
            />
            <div className="copy-row">
              <CopyButton text={listing.title} label="title" />
            </div>
          </div>

          <div className="meta-row">
            <div className="stat editable">
              <label className="k" htmlFor={`price-${group.id}`}>
                Price
              </label>
              <div className="price-input">
                <span aria-hidden="true">$</span>
                <input
                  id={`price-${group.id}`}
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={priceToInput(listing.suggested_price)}
                  onChange={(e) =>
                    onEdit(group.id, {
                      suggested_price:
                        e.target.value === "" ? "" : Number(e.target.value),
                    })
                  }
                />
              </div>
            </div>
            <div className="stat editable">
              <label className="k" htmlFor={`cond-${group.id}`}>
                Condition
              </label>
              <select
                id={`cond-${group.id}`}
                value={listing.condition ?? "GOOD"}
                onChange={(e) => onEdit(group.id, { condition: e.target.value })}
              >
                {listing.condition &&
                  !CONDITIONS.some((c) => c.value === listing.condition) && (
                    <option value={listing.condition}>
                      {listing.condition.replace(/_/g, " ")}
                    </option>
                  )}
                {CONDITIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            {listing.brand && (
              <div className="stat">
                <div className="k">Brand</div>
                <div className="v">{listing.brand}</div>
              </div>
            )}
            {listing.size && (
              <div className="stat">
                <div className="k">Size</div>
                <div className="v">{listing.size}</div>
              </div>
            )}
          </div>

          {/* Condition Notes — editable */}
          <div className="result-field">
            <label>
              Condition notes
              <button
                type="button"
                className="btn-ghost inline-edit-toggle"
                onClick={() => setEditingConditionNotes((v) => !v)}
              >
                {editingConditionNotes ? "Done" : "Edit"}
              </button>
            </label>
            {editingConditionNotes ? (
              <textarea
                value={displayedConditionNotes}
                rows={3}
                placeholder="Add your own condition notes — visible in the description"
                onChange={(e) =>
                  onEdit(group.id, { condition_notes_override: e.target.value })
                }
              />
            ) : (
              <p className="condition-notes-display">
                {displayedConditionNotes || (
                  <span style={{ color: "var(--color-ink-faint)" }}>
                    No condition notes — click Edit to add
                  </span>
                )}
              </p>
            )}
          </div>

          {/* Shipping estimate */}
          {shippingLine && (
            <div className="result-field shipping-estimate">
              <label>Estimated shipping</label>
              <p className="shipping-line">{shippingLine}</p>
            </div>
          )}

          {/* Category */}
          {listing.category_id && (
            <div className="result-field">
              <label>eBay category ID</label>
              <p className="category-id">{listing.category_id}</p>
            </div>
          )}

          <div className="result-field">
            <label>Description</label>
            <textarea
              value={listing.description}
              onChange={(e) => onEdit(group.id, { description: e.target.value })}
              rows={8}
            />
            <div className="copy-row">
              <CopyButton text={listing.description} label="description" />
            </div>
          </div>

          {specifics.length > 0 && (
            <details className="specifics-details">
              <summary>{specifics.length} item specifics</summary>
              <div className="specifics">
                {specifics.map(([k, v]) => (
                  <div className="row" key={k}>
                    <span className="k">{k}</span>
                    <span>{v}</span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* Item cost field */}
          {listing && (
            <div className="cost-row">
              <label className="cost-label" htmlFor={`cost-${group.id}`}>
                My cost:
              </label>
              <span className="cost-prefix">$</span>
              <input
                id={`cost-${group.id}`}
                type="number"
                min="0"
                step="0.01"
                className="cost-input"
                value={costInput}
                onChange={(e) => setCostInput(e.target.value)}
                onBlur={(e) => {
                  const val = parseFloat(e.target.value);
                  const clean = isNaN(val) ? 10 : Math.max(0, parseFloat(val.toFixed(2)));
                  setCostInput(clean.toFixed(2));
                  onCostChange(group.id, clean);
                }}
              />
            </div>
          )}

          {/* Pricing analysis panel */}
          {listing && (
            <div className="pricing-panel">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={runPricingAnalysis}
                disabled={pricingLoading}
              >
                {pricingLoading ? (
                  <><span className="spinner" aria-hidden="true" /> Analyzing pricing…</>
                ) : (
                  "💰 Get pricing analysis"
                )}
              </button>
              {pricingOpen && (
                <div className="pricing-result">
                  {pricingLoading && (
                    <p className="pricing-loading">Pulling eBay sold comps and analyzing photos…</p>
                  )}
                  {pricingError && (
                    <p className="pricing-error">⚠️ {pricingError}</p>
                  )}
                  {pricingResult && (
                    <div className="pricing-analysis">
                      <div className="pricing-analysis-header">
                        <strong>💰 Pricing Analysis</strong>
                        <button
                          type="button"
                          className="btn-close-small"
                          onClick={() => { setPricingOpen(false); setPricingResult(null); }}
                        >✕</button>
                      </div>
                      <pre className="pricing-text">{pricingResult}</pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* eBay posting */}
          {group.postStatus === "posted" ? (
            <p className="post-result ok">
              ✅ Posted to eBay
              {group.listingId ? (
                <>
                  {" "}
                  ·{" "}
                  <a
                    href={`https://www.ebay.com/itm/${group.listingId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View listing ↗
                  </a>
                </>
              ) : null}
              {" "}
              ·{" "}
              <button
                type="button"
                className="btn-link-inline"
                onClick={() => onUndoPosted(group.id)}
                title="If this didn't actually go live as its own listing (e.g. it shares a SKU another item already used), clear this status so you can post it again."
              >
                Not actually posted? Undo
              </button>
            </p>
          ) : ebayConnected ? (
            <div className="post-row">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onPost(group.id)}
                disabled={group.postStatus === "posting"}
              >
                {group.postStatus === "posting" ? (
                  <>
                    <span className="spinner" aria-hidden="true" /> Posting to eBay…
                  </>
                ) : (
                  "🚀 Post this to eBay"
                )}
              </button>
              {group.postStatus === "error" && group.postError && (
                <p className="post-result err">⚠️ {group.postError}</p>
              )}
            </div>
          ) : (
            <p className="post-hint">Connect eBay (top of page) to post this listing.</p>
          )}
        </div>
      )}
    </article>
  );
}


