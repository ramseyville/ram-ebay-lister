"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiPost } from "@/lib/api-client";
import { resizeImage } from "@/lib/resize";
import { buildSku, nextSuffix } from "@/lib/sku";
import { saveDraft, loadDraft, clearDraft, hasDraft, formatDraftAge } from "@/lib/storage";
import { addToLedger } from "@/lib/ledger";
import { estimateShipping } from "@/lib/shipping";
import { EbayConnect } from "./EbayConnect";
import { ReviewBoard } from "./ReviewBoard";
import { ListingsView } from "./ListingsView";
import type {
  AnalyzeResponse,
  ItemGroup,
  ListingResult,
  Photo,
  SortResponse,
} from "@/lib/types";

type Step = "upload" | "review" | "listings";
// Keep a whole batch's sort payload comfortably under Vercel's 4.5 MB request
// limit (sort sends small thumbnails for every photo at once).
const MAX_PHOTOS = 100;
const WRITE_CONCURRENCY = 3;

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Math.floor(performance.now() * 1000)}-${Math.random()}`;
}

// Parse a fetch response as JSON, but turn non-JSON error bodies (e.g. a 413
// "Request Entity Too Large" plain-text page) into a friendly message instead
// of a cryptic "Unexpected token" error.
async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    if (res.status === 413) {
      throw new Error(
        "That was too much photo data to send at once. Try sorting fewer photos per batch."
      );
    }
    throw new Error(
      text.trim().slice(0, 140) || `Request failed (${res.status}).`
    );
  }
}

// Run async workers over items with a fixed concurrency limit.
async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      await worker(items[idx]);
    }
  });
  await Promise.all(runners);
}

export default function Home() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [binPrefix, setBinPrefix] = useState("");
  const [step, setStep] = useState<Step>("upload");
  const [groups, setGroups] = useState<ItemGroup[]>([]);
  const [orphanIds, setOrphanIds] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [sorting, setSorting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ebayConnected, setEbayConnected] = useState(false);
  const [lastSaved, setLastSaved] = useState<number | null>(null);
  const [draftMeta, setDraftMeta] = useState<ReturnType<typeof hasDraft>>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const photoMap = useMemo(() => {
    const m = new Map<string, Photo>();
    photos.forEach((p) => m.set(p.id, p));
    return m;
  }, [photos]);
  const photoById = useCallback((id: string) => photoMap.get(id), [photoMap]);

  // Latest groups, readable inside async workers without stale closures.
  const groupsRef = useRef(groups);
  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  // Keep eBay connection status in sync (also after the connect bar updates).
  useEffect(() => {
    const check = () =>
      fetch("/api/ebay/status", { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => setEbayConnected(Boolean(d.connected)))
        .catch(() => setEbayConnected(false));
    check();
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // Listen for eBay connection completion from the popup window
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "ebay-connected") {
        setEbayConnected(true);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // Check for a saved draft on mount
  useEffect(() => {
    const meta = hasDraft();
    if (meta) setDraftMeta(meta);
  }, []);

  // ── Upload ──────────────────────────────────────────────
  const addFiles = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setError(null);
    const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) {
      setError("Those didn't look like photos. Use JPG, PNG, or WebP.");
      return;
    }
    try {
      const resized = await Promise.all(files.map(resizeImage));
      setPhotos((prev) =>
        [...prev, ...resized.map((r) => ({ id: newId(), ...r }))].slice(
          0,
          MAX_PHOTOS
        )
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const removePhoto = (id: string) =>
    setPhotos((prev) => prev.filter((p) => p.id !== id));

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void addFiles(e.dataTransfer.files);
  };

  // ── Sort ────────────────────────────────────────────────
  const sort = async () => {
    if (photos.length === 0) return;
    setSorting(true);
    setError(null);
    try {
      const res = await apiPost("/api/sort", {
        // Use the small thumbnail for sorting to keep the payload small.
        images: photos.map((p) => ({
          mediaType: p.mediaType,
          data: p.previewUrl.split(",")[1],
        })),
      });
      const data = (await readJson(res)) as SortResponse;
      if (!data.ok || !data.groups) {
        throw new Error(data.error || "Could not sort the photos.");
      }
      const idxToId = (i: number) => photos[i]?.id;
      const assigned = new Set<string>();
      const nextGroups: ItemGroup[] = data.groups.map((g, i) => {
        const ids = g.photoIndices.map(idxToId).filter(Boolean) as string[];
        ids.forEach((id) => assigned.add(id));
        return {
          id: newId(),
          sku: buildSku(binPrefix, i),
          name: g.name,
          photoIds: ids,
          status: "idle",
        };
      });
      const orphans = (data.orphanIndices ?? [])
        .map(idxToId)
        .filter(Boolean) as string[];
      orphans.forEach((id) => assigned.add(id));
      // Any photo the sorter never placed shouldn't vanish — surface it.
      const leftover = photos.filter((p) => !assigned.has(p.id)).map((p) => p.id);
      setGroups(nextGroups);
      setOrphanIds([...orphans, ...leftover]);
      setStep("review");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSorting(false);
    }
  };

  // ── Review edits ────────────────────────────────────────
  const rename = (groupId: string, name: string) =>
    setGroups((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, name } : g))
    );

  // If the typed SKU collides with another item already in the batch, treat
  // it as a shared label (like a bin prefix) and auto-suffix it — e.g. typing
  // "CLOSET" on three jackets becomes CLOSET-A, CLOSET-B, CLOSET-C instead of
  // three items silently merging into one eBay listing.
  const renameSku = (groupId: string, sku: string) =>
    setGroups((prev) => {
      const trimmed = sku.trim();
      const others = prev.filter((g) => g.id !== groupId);
      const collides = trimmed && others.some((g) => g.sku.trim() === trimmed);
      if (!collides) {
        return prev.map((g) => (g.id === groupId ? { ...g, sku } : g));
      }
      const taken = new Set(others.map((g) => g.sku.trim()));
      let n = 1;
      let candidate = `${trimmed}-${nextSuffix(n - 1)}`;
      // Also reserve the bare label for the very first item that claims it,
      // so a single jacket typed as "CLOSET" doesn't get an unnecessary
      // suffix unless a second one collides with it.
      if (!taken.has(trimmed)) {
        candidate = trimmed;
      } else {
        while (taken.has(candidate)) {
          n += 1;
          candidate = `${trimmed}-${nextSuffix(n - 1)}`;
        }
      }
      return prev.map((g) => (g.id === groupId ? { ...g, sku: candidate } : g));
    });

  const movePhoto = (photoId: string, toGroupId: string | "orphans") => {
    setGroups((prev) =>
      prev.map((g) => ({
        ...g,
        photoIds:
          g.id === toGroupId
            ? g.photoIds.includes(photoId)
              ? g.photoIds
              : [...g.photoIds, photoId]
            : g.photoIds.filter((id) => id !== photoId),
      }))
    );
    setOrphanIds((prev) => {
      const without = prev.filter((id) => id !== photoId);
      return toGroupId === "orphans" ? [...without, photoId] : without;
    });
  };

  const deleteGroup = (groupId: string) =>
    setGroups((prev) => {
      const target = prev.find((g) => g.id === groupId);
      if (target && target.photoIds.length > 0) {
        setOrphanIds((o) => [...o, ...target.photoIds]);
      }
      return prev.filter((g) => g.id !== groupId);
    });

  const addGroup = () =>
    setGroups((prev) => {
      const existingSkus = new Set(prev.map((g) => g.sku));
      let idx = prev.length;
      let sku = buildSku(binPrefix, idx);
      // Deleting items can free up an index buildSku would reuse — keep
      // advancing until we land on a SKU that isn't already taken.
      while (existingSkus.has(sku)) {
        idx += 1;
        sku = buildSku(binPrefix, idx);
      }
      return [
        ...prev,
        {
          id: newId(),
          sku,
          name: `new-item-${prev.length + 1}`,
          photoIds: [],
          status: "idle",
        },
      ];
    });

  // ── Write listings ──────────────────────────────────────
  const writeGroup = useCallback(
    async (groupId: string) => {
      // Snapshot this group's photos from the latest state (no stale closure).
      const group = groupsRef.current.find((g) => g.id === groupId);
      if (!group) return;
      const imgs = group.photoIds
        .map((id) => photoMap.get(id))
        .filter((p): p is Photo => Boolean(p))
        .map((p) => ({ mediaType: p.mediaType, data: p.data }));
      setGroups((prev) =>
        prev.map((g) =>
          g.id === groupId ? { ...g, status: "writing", error: undefined } : g
        )
      );
      try {
        const res = await apiPost("/api/analyze", { profile: "auto", images: imgs });
        const data = (await readJson(res)) as AnalyzeResponse;
        if (!data.ok || !data.listing) {
          throw new Error(data.error || "Could not write this listing.");
        }

        // Enrich the listing with shipping estimate
        const shippingEst = estimateShipping(data.listing);
        const enrichedListing: ListingResult = {
          ...data.listing,
          shipping_weight_oz: shippingEst.weight_oz,
          shipping_dimensions: shippingEst.dimensions,
        };

        // Attempt eBay category ID lookup via Taxonomy API (best-effort,
        // requires eBay dev keys — silently skips if not configured)
        let finalListing = enrichedListing;
        try {
          const hint = enrichedListing.category_hint || enrichedListing.title || "";
          if (hint && !enrichedListing.category_id) {
            const catRes = await fetch(
              `/api/ebay/taxonomy?q=${encodeURIComponent(hint)}`
            );
            if (catRes.ok) {
              const catData = (await catRes.json()) as { categoryId?: string };
              if (catData.categoryId) {
                finalListing = { ...enrichedListing, category_id: catData.categoryId };
              }
            }
          }
        } catch {
          // Category lookup is best-effort — never fail a write because of it
        }

        setGroups((prev) =>
          prev.map((g) =>
            g.id === groupId
              ? { ...g, status: "done", listing: finalListing }
              : g
          )
        );
      } catch (e) {
        setGroups((prev) =>
          prev.map((g) =>
            g.id === groupId
              ? { ...g, status: "error", error: (e as Error).message }
              : g
          )
        );
      }
    },
    [photoMap]
  );

  const writeAll = async () => {
    const usable = groups.filter((g) => g.photoIds.length > 0).map((g) => g.id);
    if (usable.length === 0) return;
    setStep("listings");
    await runPool(usable, WRITE_CONCURRENCY, writeGroup);
  };

  const editListing = (groupId: string, patch: Partial<ListingResult>) =>
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId && g.listing
          ? { ...g, listing: { ...g.listing, ...patch } }
          : g
      )
    );

  const postGroup = useCallback(
    async (groupId: string) => {
      const group = groupsRef.current.find((g) => g.id === groupId);
      if (!group || !group.listing) return;

      const sku = (group.sku || "").trim();
      if (!sku) {
        setGroups((prev) =>
          prev.map((g) =>
            g.id === groupId
              ? { ...g, postStatus: "error", postError: "This item has no SKU — add one before posting." }
              : g
          )
        );
        return;
      }
      const duplicate = groupsRef.current.find((g) => g.id !== groupId && (g.sku || "").trim() === sku);
      if (duplicate) {
        setGroups((prev) =>
          prev.map((g) =>
            g.id === groupId
              ? {
                  ...g,
                  postStatus: "error",
                  postError: `SKU "${sku}" is also used by "${duplicate.name}" — eBay will merge these into one listing. Give each item a unique SKU before posting.`,
                }
              : g
          )
        );
        return;
      }

      const images = group.photoIds
        .map((id) => photoMap.get(id))
        .filter((p): p is Photo => Boolean(p))
        .map((p) => ({ mediaType: p.mediaType, data: p.data }));
      setGroups((prev) =>
        prev.map((g) =>
          g.id === groupId ? { ...g, postStatus: "posting", postError: undefined } : g
        )
      );
      try {
        const res = await apiPost("/api/ebay/publish", {
          sku: group.sku,
          listing: group.listing,
          images,
        });
        const data = (await readJson(res)) as {
          success: boolean;
          listingId?: string;
          error?: string;
        };
        if (!data.success) throw new Error(data.error || "eBay rejected the listing.");
        // Add to monthly ledger
        const postedGroup = groupsRef.current.find((g) => g.id === groupId);
        if (postedGroup?.listing) {
          const binPrice = parseFloat(String(postedGroup.listing.suggested_price || "0").replace(/[^0-9.]/g, ""));
          if (!isNaN(binPrice) && binPrice > 0) {
            addToLedger({
              sku: postedGroup.sku,
              title: postedGroup.listing.title,
              brand: postedGroup.listing.brand,
              size: postedGroup.listing.size,
              condition: postedGroup.listing.condition,
              itemCost: postedGroup.itemCost ?? 10,
              binPrice,
              listingId: data.listingId,
            });
          }
        }
        setGroups((prev) =>
          prev.map((g) =>
            g.id === groupId
              ? { ...g, postStatus: "posted", listingId: data.listingId }
              : g
          )
        );
      } catch (e) {
        setGroups((prev) =>
          prev.map((g) =>
            g.id === groupId
              ? { ...g, postStatus: "error", postError: (e as Error).message }
              : g
          )
        );
      }
    },
    [photoMap]
  );

  const undoPosted = useCallback((groupId: string) => {
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId
          ? { ...g, postStatus: undefined, listingId: undefined, postError: undefined }
          : g
      )
    );
  }, []);

  const handleCostChange = useCallback((groupId: string, cost: number) => {
    setGroups((prev) =>
      prev.map((g) => g.id === groupId ? { ...g, itemCost: cost } : g)
    );
  }, []);

  const postAll = async () => {
    const ready = groups
      .filter((g) => g.status === "done" && g.postStatus !== "posted")
      .map((g) => g.id);
    // Sequential — keeps eBay calls gentle and errors easy to read.
    for (const id of ready) {
      await postGroup(id);
    }
  };

  const handleSaveDraft = useCallback(() => {
    const ok = saveDraft(groups, photos, binPrefix, step);
    if (ok) {
      const now = Date.now();
      setLastSaved(now);
      setDraftMeta(hasDraft());
    }
  }, [groups, photos, binPrefix, step]);

  const handleRestoreDraft = useCallback(() => {
    const draft = loadDraft();
    if (!draft) return;
    setGroups(draft.groups);
    setPhotos(draft.photos);
    setBinPrefix(draft.meta.binPrefix);
    setStep(draft.meta.step);
    setDraftMeta(null);
  }, []);

  const handleDiscardDraft = useCallback(() => {
    clearDraft();
    setDraftMeta(null);
  }, []);

  const usableGroups = useMemo(
    () => groups.filter((g) => g.photoIds.length > 0),
    [groups]
  );

  return (
    <main className="wrap">
      <header className="masthead">
        <span className="logo-mark" aria-hidden="true">
          🪄
        </span>
        <div>
          <h1>Listing Writer</h1>
          <p>Upload a pile of photos · auto-sort into items · write every listing.</p>
        </div>
      </header>

      <EbayConnect />

      {step === "upload" && (
        <>
          {/* Draft restore banner */}
          {draftMeta && (
            <div className="draft-banner" role="alert">
              <span>
                📂 You have a saved draft from {formatDraftAge(draftMeta.savedAt)} —{" "}
                {draftMeta.itemCount} item{draftMeta.itemCount !== 1 ? "s" : ""},
                {" "}{draftMeta.photoCount} photo{draftMeta.photoCount !== 1 ? "s" : ""}
              </span>
              <div className="draft-banner-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleRestoreDraft}
                >
                  Restore draft
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={handleDiscardDraft}
                >
                  Discard
                </button>
              </div>
            </div>
          )}
          <section className="hero">
            <h2>
              Dump every photo. <em>We&rsquo;ll sort it out.</em>
            </h2>
            <p>
              Add all your photos for the whole batch at once. The app groups
              them into separate items, then writes a polished eBay listing for
              each one.
            </p>
          </section>

          <section className="panel" aria-labelledby="upload-heading">
            <h2 id="upload-heading" className="section-label">
              1 · Add all your photos
            </h2>

            <div className="field bin-field">
              <label htmlFor="bin">
                Bin / SKU code{" "}
                <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
                  (where these items are stored)
                </span>
              </label>
              <input
                id="bin"
                type="text"
                placeholder="e.g. K75"
                value={binPrefix}
                onChange={(e) => setBinPrefix(e.target.value)}
                autoCapitalize="characters"
              />
              <span className="field-hint">
                Each item gets {binPrefix ? `${binPrefix.trim()}-A, ${binPrefix.trim()}-B` : "A, B, C"}
                … in order, so you can find it in the bin later. You can edit any
                SKU after sorting.
              </span>
            </div>

            <div
              className={`dropzone${dragging ? " dragging" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <span className="icon" aria-hidden="true">
                📸
              </span>
              <strong>Tap to choose photos, or drag them all here</strong>
              <span>
                Every item in the batch · up to {MAX_PHOTOS} photos · JPG, PNG,
                WebP
              </span>
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => void addFiles(e.target.files)}
              />
            </div>

            {photos.length > 0 && (
              <div className="thumbs" aria-label="Selected photos">
                {photos.map((p) => (
                  <div className="thumb" key={p.id}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.previewUrl} alt="" />
                    <button
                      type="button"
                      aria-label="Remove photo"
                      onClick={() => removePhoto(p.id)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="result-actions" style={{ borderTop: "none", paddingTop: 0 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={sort}
                disabled={photos.length === 0 || sorting}
              >
                {sorting ? (
                  <>
                    <span className="spinner" aria-hidden="true" /> Sorting{" "}
                    {photos.length} photos…
                  </>
                ) : (
                  <>🔀 Sort {photos.length || ""} photos into items</>
                )}
              </button>
              {photos.length > 0 && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setPhotos([]);
                    setGroups([]);
                    clearDraft();
                    if (inputRef.current) inputRef.current.value = "";
                  }}
                >
                  🗑 Clear all photos
                </button>
              )}
            </div>

            {error && (
              <p className="note note-error" role="alert">
                {error}
              </p>
            )}
          </section>

          {sorting && (
            <section className="panel">
              <div className="loading-card">
                <span className="spinner" aria-hidden="true" />
                <span>
                  Grouping photos by item, then double-checking for mixed-up or
                  split items. This takes a little while for big batches.
                </span>
              </div>
            </section>
          )}
        </>
      )}

      {step === "review" && (
        <ReviewBoard
          groups={groups}
          orphanIds={orphanIds}
          photoById={photoById}
          onRename={rename}
          onRenameSku={renameSku}
          onMovePhoto={movePhoto}
          onDeleteGroup={deleteGroup}
          onAddGroup={addGroup}
          onWriteAll={writeAll}
          onBack={() => setStep("upload")}
        />
      )}

      {step === "listings" && (
        <ListingsView
          groups={usableGroups}
          photoById={photoById}
          ebayConnected={ebayConnected}
          onEdit={editListing}
          onRetry={writeGroup}
          onPost={postGroup}
          onPostAll={postAll}
          onCostChange={handleCostChange}
          onRenameSku={renameSku}
          onUndoPosted={undoPosted}
          onBack={() => setStep("review")}
          onSaveDraft={handleSaveDraft}
          lastSaved={lastSaved}
        />
      )}

      <p className="footnote">
        Your photos are sent securely to sort and write listings, and are not
        stored. One-click posting to eBay is coming in the next phase.
      </p>
    </main>
  );
}

