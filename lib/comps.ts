// Comparable-listing searches for pricing. Starts from an exact match on
// brand + style + color + size + condition, then widens in Mark's order when
// too few comps come back: drop size, then color, then condition.
//
// Pure module — no server imports — so the listing card can build the
// "view sold" links and the pricing route can run the same searches.

import { normalizeConditionGrade } from "@/lib/conditions";
import { plainColorFrom } from "@/lib/title";
import type { ListingResult } from "@/lib/types";

// Fewer active matches than this and the search widens a step.
export const MIN_COMPS = 8;

export interface CompLevel {
  key: "exact" | "no_size" | "no_color" | "any_condition";
  label: string;
  // Brand + style (+ color) words for the search box.
  keywords: string;
  // Searched as eBay's Size field when the category is known, else as a word.
  size: string;
  // eBay condition IDs to match; empty = any condition.
  conditionIds: number[];
}

/** Condition IDs that count as "the same condition" for comps. */
export function compConditionIds(condition: string | undefined): number[] {
  switch (normalizeConditionGrade(condition)) {
    case "NEW_WITH_TAGS":
      return [1000];
    case "NEW_NO_TAGS":
      return [1500];
    case "NEW_WITH_DEFECTS":
      return [1750];
    default:
      // Any pre-owned grade — eBay's pre-owned buckets are too thin to split.
      return [2990, 3000, 3010, 4000, 5000, 6000];
  }
}

const join = (...parts: (string | undefined | null)[]) =>
  parts.map((p) => (p || "").trim()).filter(Boolean).join(" ").replace(/\s+/g, " ");

/** The search ladder for a listing, most specific first. */
export function compLevels(listing: ListingResult): CompLevel[] {
  const specifics = listing.item_specifics || {};
  const brand = (listing.brand || specifics.Brand || "").trim();
  const style = join(specifics["Product Line"] || specifics.Model || "", listing.item_type || "");
  const color = plainColorFrom(listing.color) || "";
  const size = (listing.size || "").trim();
  const cond = compConditionIds(listing.condition);
  const base = join(brand, style) || (listing.title || "").split(" ").slice(0, 6).join(" ");

  return [
    { key: "exact", label: "Exact match", keywords: join(base, color), size, conditionIds: cond },
    { key: "no_size", label: "Any size", keywords: join(base, color), size: "", conditionIds: cond },
    { key: "no_color", label: "Any size or color", keywords: base, size: "", conditionIds: cond },
    { key: "any_condition", label: "Any size, color, or condition", keywords: base, size: "", conditionIds: [] },
  ];
}

const searchText = (level: CompLevel) => join(level.keywords, level.size);

/** eBay's own sold-listings search for a level (opens in the browser). */
export function soldSearchUrl(level: CompLevel): string {
  const u = new URL("https://www.ebay.com/sch/i.html");
  u.searchParams.set("_nkw", searchText(level));
  u.searchParams.set("LH_Sold", "1");
  u.searchParams.set("LH_Complete", "1");
  if (level.conditionIds.length) u.searchParams.set("LH_ItemCondition", level.conditionIds.join("|"));
  return u.toString();
}

/** Terapeak (Seller Hub research) sold results for a level, last 90 days. */
export function terapeakUrl(level: CompLevel): string {
  const u = new URL("https://www.ebay.com/sh/research");
  u.searchParams.set("marketplace", "EBAY-US");
  u.searchParams.set("keywords", searchText(level));
  u.searchParams.set("dayRange", "90");
  u.searchParams.set("tabName", "SOLD");
  return u.toString();
}
