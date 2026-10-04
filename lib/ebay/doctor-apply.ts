// Listing Doctor: apply an approved version to a live listing, with a backup
// saved to the database FIRST (no backup → no change), and undo from it.

import { ensureSchema, query } from "@/lib/db";
import type { ListingResult } from "@/lib/types";
import { fillMissingAspects } from "./aspect-fill";
import { categoryAspects, type AspectMeta } from "./taxonomy";
import { getItem, reviseItem, type TradingItem } from "./trading";

export interface DoctorVersion {
  title: string;
  description: string;
  price: number;
  categoryId: string;
  specifics: Record<string, string[]>;
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
  if (!meta.length) return specs;
  const listing: ListingResult = {
    title: v.title,
    description: v.description,
    brand: specs.Brand?.[0],
    size: specs.Size?.[0],
    color: specs.Color?.join(", "),
    material: specs.Material?.join(", "),
    condition: current.conditionName,
  };
  await fillMissingAspects(specs, meta, listing);
  return validateSpecifics(specs, meta);
}

export async function applyVersion(
  token: string,
  itemId: string,
  v: DoctorVersion
): Promise<{ backupId: number; specifics: number }> {
  await ensureSchema();
  const current = await getItem(token, itemId);
  const specifics = await finalSpecifics(v, current);
  const categoryId = v.categoryId && v.categoryId !== current.categoryId ? v.categoryId : undefined;

  const [row] = await query<{ id: number | string }>(
    `INSERT INTO doctor_backups (item_id, sku, backup) VALUES ($1, $2, $3::jsonb) RETURNING id`,
    [itemId, current.sku, JSON.stringify(current)]
  );
  const backupId = Number(row?.id);
  if (!backupId) throw new Error("Couldn't save a backup, so nothing was changed.");

  const applied = { title: v.title, description: v.description, price: v.price, categoryId, specifics, bestOfferEnabled: true };
  await reviseItem(token, itemId, applied);
  await query(`UPDATE doctor_backups SET applied = $2::jsonb, applied_at = now() WHERE id = $1`, [
    backupId,
    JSON.stringify(applied),
  ]);
  return { backupId, specifics: Object.keys(specifics).length };
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
  const b = parseJson<TradingItem>(row.backup);
  await reviseItem(token, itemId, {
    title: b.title,
    description: b.description,
    price: b.price,
    categoryId: b.categoryId,
    specifics: b.specifics,
    bestOfferEnabled: b.bestOfferEnabled,
  });
  await query(`UPDATE doctor_backups SET restored_at = now() WHERE id = $1`, [Number(row.id)]);
}
