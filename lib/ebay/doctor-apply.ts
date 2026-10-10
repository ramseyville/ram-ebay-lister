// Listing Doctor: apply an approved version to a live listing, with a backup
// saved to the database FIRST (no backup → no change), and undo from it.
//
// Two edit paths:
//  • Listings made in Seller Hub / other tools → Trading API ReviseFixedPriceItem.
//  • Listings made by THIS app (Inventory API) → eBay refuses Trading revises
//    on those, so update the inventory item + offer and republish, the same
//    way the app's price/quantity updates do.

import { ensureSchema, query } from "@/lib/db";
import { fitDescription } from "@/lib/description";
import type { ListingResult } from "@/lib/types";
import { fillMissingAspects } from "./aspect-fill";
import { cleanNumericAspects } from "./aspect-number";
import { EBAY_INV_BASE, EBAY_MARKETPLACE_ID } from "./config";
import { CONTENT_LANGUAGE, ebayRequest, updateOfferBody } from "./publish";
import { categoryAspects, type AspectMeta } from "./taxonomy";
import { getItem, reviseItem, type ReviseFields, type TradingItem } from "./trading";

export interface DoctorVersion {
  title: string;
  description: string;
  price: number;
  categoryId: string;
  specifics: Record<string, string[]>;
}

interface InventoryListing {
  offer: any;
  inventoryItem: any;
}

interface Backup {
  trading: TradingItem;
  inventory?: InventoryListing; // present when the app created the listing
}

/** eBay's own fields only; dropdown fields mapped to eBay's exact wording. */
function validateSpecifics(specs: Record<string, string[]>, meta: AspectMeta[]): Record<string, string[]> {
  if (!meta.length) return specs;
  const out: Record<string, string[]> = {};
  for (const a of meta) {
    const vals = (specs[a.name] || []).map((v) => String(v || "").trim()).filter(Boolean);
    if (!vals.length) continue;
    let keep = vals;
    if (a.mode === "SELECTION_ONLY") {
      keep = vals
        .map((v) => {
          const lv = v.toLowerCase();
          return a.values.find((x) => {
            const lx = x.toLowerCase();
            return lx === lv || lx === `${lv}s` || `${lx}s` === lv;
          });
        })
        .filter((v): v is string => Boolean(v));
    }
    keep = Array.from(new Set(keep)).slice(0, a.multi ? 30 : 1);
    if (keep.length) out[a.name] = keep;
  }
  return out;
}

async function finalSpecifics(v: DoctorVersion, current: TradingItem): Promise<Record<string, string[]>> {
  const meta = await categoryAspects(v.categoryId || current.categoryId).catch(() => []);
  const specs = validateSpecifics(v.specifics, meta);
  if (!meta.length) {
    cleanNumericAspects(specs, meta);
    return specs;
  }
  const listing: ListingResult = {
    title: v.title,
    description: v.description,
    brand: specs.Brand?.[0],
    size: specs.Size?.[0],
    color: specs.Color?.join(", "),
    material: specs.Material?.join(", "),
    condition: current.conditionName,
  };
  await fillMissingAspects(specs, meta, listing, current.pictures);
  const out = validateSpecifics(specs, meta);
  cleanNumericAspects(out, meta);
  return out;
}

/** The Inventory API offer behind this listing, if the app created it. */
async function findInventoryListing(token: string, sku: string, itemId: string): Promise<InventoryListing | null> {
  if (!sku) return null;
  const enc = encodeURIComponent(sku);
  const offers = await ebayRequest(token, "GET", `${EBAY_INV_BASE}/offer?sku=${enc}&marketplace_id=${EBAY_MARKETPLACE_ID}`);
  if (!offers.ok) return null;
  const offer = (offers.json?.offers || []).find((o: any) => String(o?.listing?.listingId || "") === itemId);
  if (!offer?.offerId) return null;
  const inv = await ebayRequest(token, "GET", `${EBAY_INV_BASE}/inventory_item/${enc}`);
  if (!inv.ok || !inv.json) return null;
  return { offer, inventoryItem: inv.json };
}

function ebayError(what: string, r: { status: number; text: string }): Error {
  return new Error(`eBay rejected the ${what} (${r.status}): ${r.text.slice(0, 1500)}`);
}

/** Edit an app-created listing: inventory item + offer, then republish. */
async function reviseInventoryListing(
  token: string,
  sku: string,
  inv: InventoryListing,
  f: ReviseFields
): Promise<void> {
  const item = inv.inventoryItem;
  const product = { ...(item.product || {}) };
  if (f.title !== undefined) product.title = f.title.slice(0, 80);
  if (f.description !== undefined) product.description = fitDescription(f.description);
  if (f.specifics) product.aspects = f.specifics;
  const putItem = await ebayRequest(token, "PUT", `${EBAY_INV_BASE}/inventory_item/${encodeURIComponent(sku)}`, {
    body: { ...item, product },
    extraHeaders: CONTENT_LANGUAGE,
  });
  if (![200, 201, 204].includes(putItem.status)) throw ebayError("item update", putItem);

  const offer = { ...inv.offer };
  if (f.description !== undefined) offer.listingDescription = f.description;
  if (f.price !== undefined && f.price > 0) {
    offer.pricingSummary = { ...(offer.pricingSummary || {}), price: { value: f.price.toFixed(2), currency: "USD" } };
  }
  if (f.categoryId) offer.categoryId = f.categoryId;
  if (f.bestOfferEnabled !== undefined) {
    const policies = { ...(offer.listingPolicies || {}) };
    // Keep any auto-accept / auto-decline amounts exactly as they are.
    policies.bestOfferTerms = { ...(policies.bestOfferTerms || {}), bestOfferEnabled: f.bestOfferEnabled };
    offer.listingPolicies = policies;
  }
  const putOffer = await ebayRequest(token, "PUT", `${EBAY_INV_BASE}/offer/${offer.offerId}`, {
    body: updateOfferBody(offer),
    extraHeaders: CONTENT_LANGUAGE,
  });
  if (![200, 201, 204].includes(putOffer.status)) throw ebayError("offer update", putOffer);

  const pub = await ebayRequest(token, "POST", `${EBAY_INV_BASE}/offer/${offer.offerId}/publish`, {
    extraHeaders: CONTENT_LANGUAGE,
  });
  if (!pub.ok) throw ebayError("republish", pub);
}

export async function applyVersion(
  token: string,
  itemId: string,
  v: DoctorVersion,
  opts: { onlyIfPrice?: number } = {}
): Promise<{ backupId: number; specifics: number; path: "seller-hub" | "app" }> {
  await ensureSchema();
  const current = await getItem(token, itemId);
  // A queued bulk fix was planned from an earlier read: never undo a price the
  // seller changed on eBay since then.
  if (opts.onlyIfPrice !== undefined && Math.abs(current.price - opts.onlyIfPrice) > 0.001) {
    throw new Error(
      `The price changed on eBay since this listing was scanned ($${opts.onlyIfPrice.toFixed(2)} → $${current.price.toFixed(2)}). Nothing was changed — retry to re-scan it.`
    );
  }
  const inventory = await findInventoryListing(token, current.sku, itemId);
  const specifics = await finalSpecifics(v, current);
  const categoryId = v.categoryId && v.categoryId !== current.categoryId ? v.categoryId : undefined;

  const backup: Backup = { trading: current, ...(inventory ? { inventory } : {}) };
  const [row] = await query<{ id: number | string }>(
    `INSERT INTO doctor_backups (item_id, sku, backup) VALUES ($1, $2, $3::jsonb) RETURNING id`,
    [itemId, current.sku, JSON.stringify(backup)]
  );
  const backupId = Number(row?.id);
  if (!backupId) throw new Error("Couldn't save a backup, so nothing was changed.");

  const applied: ReviseFields = {
    title: v.title,
    description: v.description,
    price: v.price,
    categoryId,
    specifics,
    bestOfferEnabled: true,
  };
  if (inventory) await reviseInventoryListing(token, current.sku, inventory, applied);
  else await reviseItem(token, itemId, applied);

  await query(`UPDATE doctor_backups SET applied = $2::jsonb, applied_at = now() WHERE id = $1`, [
    backupId,
    JSON.stringify(applied),
  ]);
  return { backupId, specifics: Object.keys(specifics).length, path: inventory ? "app" : "seller-hub" };
}

function parseJson<T>(v: unknown): T {
  return (typeof v === "string" ? JSON.parse(v) : v) as T;
}

/** Latest applied-and-not-undone change for an item, if any. */
export async function latestApplied(itemId: string): Promise<{ id: number; appliedAt: string } | null> {
  await ensureSchema();
  const [row] = await query<{ id: number | string; applied_at: string }>(
    `SELECT id, applied_at FROM doctor_backups
      WHERE item_id = $1 AND applied IS NOT NULL AND restored_at IS NULL
      ORDER BY id DESC LIMIT 1`,
    [itemId]
  );
  return row ? { id: Number(row.id), appliedAt: String(row.applied_at) } : null;
}

export async function undoLatest(token: string, itemId: string): Promise<void> {
  await ensureSchema();
  const [row] = await query<{ id: number | string; backup: unknown }>(
    `SELECT id, backup FROM doctor_backups
      WHERE item_id = $1 AND applied IS NOT NULL AND restored_at IS NULL
      ORDER BY id DESC LIMIT 1`,
    [itemId]
  );
  if (!row) throw new Error("Nothing to undo for this listing.");
  const raw = parseJson<Backup | TradingItem>(row.backup);
  // Early backups stored the Trading listing on its own.
  const backup: Backup = "trading" in raw ? raw : { trading: raw };
  if (backup.inventory) {
    // App-created listing: put the saved inventory item and offer back as they were.
    const { inventoryItem, offer } = backup.inventory;
    const sku = backup.trading.sku;
    const putItem = await ebayRequest(token, "PUT", `${EBAY_INV_BASE}/inventory_item/${encodeURIComponent(sku)}`, {
      body: inventoryItem,
      extraHeaders: CONTENT_LANGUAGE,
    });
    if (![200, 201, 204].includes(putItem.status)) throw ebayError("item restore", putItem);
    const putOffer = await ebayRequest(token, "PUT", `${EBAY_INV_BASE}/offer/${offer.offerId}`, {
      body: updateOfferBody(offer),
      extraHeaders: CONTENT_LANGUAGE,
    });
    if (![200, 201, 204].includes(putOffer.status)) throw ebayError("offer restore", putOffer);
    const pub = await ebayRequest(token, "POST", `${EBAY_INV_BASE}/offer/${offer.offerId}/publish`, {
      extraHeaders: CONTENT_LANGUAGE,
    });
    if (!pub.ok) throw ebayError("republish", pub);
  } else {
    const b = backup.trading;
    await reviseItem(token, itemId, {
      title: b.title,
      description: b.description,
      price: b.price,
      categoryId: b.categoryId,
      specifics: b.specifics,
      bestOfferEnabled: b.bestOfferEnabled,
    });
  }
  await query(`UPDATE doctor_backups SET restored_at = now() WHERE id = $1`, [Number(row.id)]);
}
