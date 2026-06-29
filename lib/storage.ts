// Draft save/restore using localStorage.
import type { ItemGroup, Photo } from "./types";

const KEYS = { groups: "ebay-lister-draft-groups", photos: "ebay-lister-draft-photos", meta: "ebay-lister-draft-meta" } as const;

export interface DraftMeta { binPrefix: string; step: "upload" | "review" | "listings"; savedAt: number; itemCount: number; photoCount: number; }
export interface Draft { groups: ItemGroup[]; photos: Photo[]; meta: DraftMeta; }

function safeSet(key: string, value: string): boolean { try { localStorage.setItem(key, value); return true; } catch { return false; } }
function safeGet(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
function safeRemove(key: string): void { try { localStorage.removeItem(key); } catch {} }

export function saveDraft(groups: ItemGroup[], photos: Photo[], binPrefix: string, step: "upload" | "review" | "listings"): boolean {
  const meta: DraftMeta = { binPrefix, step, savedAt: Date.now(), itemCount: groups.length, photoCount: photos.length };
  try { return safeSet(KEYS.groups, JSON.stringify(groups)) && safeSet(KEYS.photos, JSON.stringify(photos)) && safeSet(KEYS.meta, JSON.stringify(meta)); } catch { return false; }
}
export function loadDraft(): Draft | null {
  try {
    const rg = safeGet(KEYS.groups), rp = safeGet(KEYS.photos), rm = safeGet(KEYS.meta);
    if (!rg || !rp || !rm) return null;
    return { groups: JSON.parse(rg) as ItemGroup[], photos: JSON.parse(rp) as Photo[], meta: JSON.parse(rm) as DraftMeta };
  } catch { return null; }
}
export function clearDraft(): void { safeRemove(KEYS.groups); safeRemove(KEYS.photos); safeRemove(KEYS.meta); }
export function hasDraft(): DraftMeta | null {
  try { const raw = safeGet(KEYS.meta); if (!raw) return null; return JSON.parse(raw) as DraftMeta; } catch { return null; }
}
export function formatDraftAge(savedAt: number): string {
  const diffMs = Date.now() - savedAt, diffMin = Math.floor(diffMs / 60_000), diffHr = Math.floor(diffMin / 60), diffDay = Math.floor(diffHr / 24);
  if (diffDay >= 1) return `${diffDay} day${diffDay > 1 ? "s" : ""} ago`;
  if (diffHr  >= 1) return `${diffHr} hour${diffHr > 1 ? "s" : ""} ago`;
  if (diffMin >= 1) return `${diffMin} minute${diffMin > 1 ? "s" : ""} ago`;
  return "just now";
}
