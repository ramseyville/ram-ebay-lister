// eBay publish pipeline, ported from ebay_lister_v2_robust.py.
// Sequence: upload photos → create inventory item → create offer → publish,
// with recovery for missing item specifics, rejected conditions, and non-leaf
// categories.

import {
  EBAY_ACC_BASE,
  EBAY_INV_BASE,
  EBAY_MARKETPLACE_ID,
  EBAY_TRADING,
} from "./config";
import {
  suggestLeafCategory,
  categoryAspects,
  acceptedConditionIds,
  type AspectMeta,
} from "./taxonomy";
import type { ListingResult } from "@/lib/types";

// ── Constants (from the Python script) ───────────────────────────────────────

const CATEGORY_MAP: Record<string, string> = {
  womens_top: "15724", womens_dress: "63861", womens_skirt: "11554",
  womens_pants: "57988", womens_coat: "57990", womens_sweater: "63864",
  womens_jeans: "11554", womens_clothing: "15724", womens_shoes: "3034",
  mens_top: "57991", mens_pants: "57989", mens_coat: "57988",
  mens_sweater: "11484", mens_jeans: "11483", mens_clothing: "1059",
  mens_shoes: "93427", handbag: "169291", wallet: "2996", jewelry: "281",
  scarf: "45238", belt: "2996", sunglasses: "79720", hat: "52382",
  accessory: "4250", doll: "22733", collectible: "1463", collector_plate: "1467",
  toy: "2550", home_decor: "10033", book: "267", knife: "7313",
  sporting_goods: "159044", electronics: "293", camera: "625", audio: "293",
  video_game: "139973", media: "11232", vinyl_record: "176985", cd: "176984",
  dvd_bluray: "617", musical_instrument: "619", kitchenware: "20625",
  glassware: "50693", pottery_ceramics: "24", art: "550", craft: "14339",
  tool: "631", automotive: "6028", office: "25298", health_beauty: "26395",
  small_appliance: "20667", lighting: "20697", linens: "20444", holiday: "16086",
  board_game: "233", puzzle: "2613", plush: "2624", action_figure: "246",
  trading_card: "183050", sports_memorabilia: "64482", coin: "11116",
  stamp: "260", ephemera: "165800", other: "99",
};

const LEAF_FALLBACKS = ["1463", "22733", "2550", "48108", "316", "171485", "2624", "2613"];

const CONDITION_ALIASES: Record<string, string> = {
  NEW: "NEW_WITH_TAGS",
  NWT: "NEW_WITH_TAGS",
  NEW_WITH_TAGS: "NEW_WITH_TAGS",
  NEW_WITH_BOX: "NEW_WITH_TAGS",
  NEW_WITHOUT_TAGS: "NEW_NO_TAGS",
  NEW_WITHOUT_BOX: "NEW_NO_TAGS",
  NEW_NO_TAGS: "NEW_NO_TAGS",
  NEW_OTHER: "NEW_NO_TAGS",
  OPEN_BOX: "NEW_NO_TAGS",
  LIKE_NEW: "EXCELLENT",
  PREOWNED_EXCELLENT: "EXCELLENT",
  PRE_OWNED_EXCELLENT: "EXCELLENT",
  USED_EXCELLENT: "EXCELLENT",
  EXCELLENT: "EXCELLENT",
  VERY_GOOD: "VERY_GOOD",
  PREOWNED_VERY_GOOD: "VERY_GOOD",
  PRE_OWNED_VERY_GOOD: "VERY_GOOD",
  USED_VERY_GOOD: "VERY_GOOD",
  USED: "GOOD",
  PREOWNED: "GOOD",
  PRE_OWNED: "GOOD",
  USED_GOOD: "GOOD",
  PREOWNED_GOOD: "GOOD",
  PRE_OWNED_GOOD: "GOOD",
  GOOD: "GOOD",
  ACCEPTABLE: "FAIR",
  USED_ACCEPTABLE: "FAIR",
  FAIR: "FAIR",
  PREOWNED_FAIR: "FAIR",
  PRE_OWNED_FAIR: "FAIR",
  USED_FAIR: "FAIR",
};

const CONDITION_ID_ENUM: Record<number, string> = {
  1000: "NEW",
  1500: "NEW_OTHER",
  1750: "NEW_WITH_DEFECTS",
  2750: "LIKE_NEW",
  2990: "PRE_OWNED_EXCELLENT",
  3000: "USED_EXCELLENT",
  3010: "PRE_OWNED_FAIR",
  4000: "USED_VERY_GOOD",
  5000: "USED_GOOD",
  6000: "USED_ACCEPTABLE",
  7000: "FOR_PARTS_OR_NOT_WORKING",
};

const GENERAL_CONDITION_ID_PREFERENCES: Record<string, number[]> = {
  NEW_WITH_TAGS: [1000, 1500, 1750],
  NEW_NO_TAGS: [1500, 1000, 1750],
  EXCELLENT: [3000, 2750, 4000, 5000],
  VERY_GOOD: [4000, 3000, 5000, 2750],
  GOOD: [5000, 4000, 3000, 6000],
  FAIR: [6000, 5000, 4000, 3000],
};

const APPAREL_CONDITION_ID_PREFERENCES: Record<string, number[]> = {
  NEW_WITH_TAGS: [1000, 1500, 1750],
  NEW_NO_TAGS: [1500, 1000, 1750],
  EXCELLENT: [2990, 3000, 3010],
  // eBay has no apparel "Very Good" tier. Use Good before overgrading as Excellent.
  VERY_GOOD: [3000, 2990, 3010],
  GOOD: [3000, 3010, 2990],
  FAIR: [3010, 3000, 2990],
};

const GENERAL_SAFE_CONDITION_IDS = [3000, 4000, 5000, 6000, 2750, 1500, 1000, 1750, 7000];
const APPAREL_SAFE_CONDITION_IDS = [3000, 2990, 3010, 1500, 1000, 1750];

const APPAREL_CATEGORIES = new Set([
  "womens_top", "womens_dress", "womens_skirt", "womens_pants", "womens_coat",
  "womens_sweater", "womens_jeans", "womens_clothing", "womens_shoes", "mens_top",
  "mens_pants", "mens_coat", "mens_sweater", "mens_jeans", "mens_clothing",
  "mens_shoes", "scarf", "belt", "hat",
]);
const PANTS_CATEGORIES = new Set([
  "womens_pants", "womens_jeans", "womens_skirt", "mens_pants", "mens_jeans",
]);

const OUTERWEAR_CATEGORIES = new Set([
  "mens_coat", "mens_jacket", "womens_coat", "womens_jacket",
]);

const TOPS_CATEGORIES = new Set([
  "mens_top", "womens_top", "mens_sweater", "womens_sweater", "mens_clothing", "womens_clothing",
]);

// Aspects that should ONLY be populated as defaults when the item is in a
// relevant category. Prevents "Hood: No Hood" on dress shirts, "Rise: Mid Rise"
// on jackets, "Leg Style: Straight" on tops, etc.
// Map of aspect name → set of category keys where the default is appropriate.
const ASPECT_CATEGORY_GATES: Record<string, Set<string>> = {
  "Hood":         OUTERWEAR_CATEGORIES,
  "Lining":       OUTERWEAR_CATEGORIES,
  "Rise":         PANTS_CATEGORIES,
  "Leg Style":    PANTS_CATEGORIES,
  "Inseam":       PANTS_CATEGORIES,
  "Waist Size":   PANTS_CATEGORIES,
  "Front Type":   PANTS_CATEGORIES,
  "Leg Opening":  PANTS_CATEGORIES,
  "Closure":      new Set([...PANTS_CATEGORIES, ...OUTERWEAR_CATEGORIES]),
  "Neckline":     TOPS_CATEGORIES,
  "Sleeve Length": TOPS_CATEGORIES,
  "Skirt Length": new Set(["womens_skirt"]),
  "Dress Length": new Set(["womens_dress"]),
  "Heel Height":  new Set(["mens_shoes", "womens_shoes"]),
  "Toe Shape":    new Set(["mens_shoes", "womens_shoes"]),
  "Shoe Width":   new Set(["mens_shoes", "womens_shoes"]),
  "Hat Style":    new Set(["hat"]),
  "Brim Style":   new Set(["hat"]),
  "Bag Closure":  new Set(["handbag", "wallet"]),
  "Strap Type":   new Set(["handbag"]),
  "Adjustable":   new Set(["handbag", "belt", "hat"]),
};

const ASPECT_DEFAULTS: Record<string, string> = {
  "Skirt Length": "Knee-Length", "Dress Length": "Knee-Length", Rise: "Mid Rise",
  "Leg Style": "Straight", Closure: "Pull-On", "Shoe Width": "Medium",
  "Heel Height": "Flat", "Toe Shape": "Round", Adjustable: "Yes",
  "Exterior Pockets": "Yes", Lining: "Lined", Hood: "No Hood", "Bag Closure": "Zip",
  "Strap Type": "Adjustable", "Hat Style": "Baseball Cap", "Brim Style": "Curved Bill",
  "Size Type": "Regular", Size: "Regular", Style: "Casual", Department: "Unisex Adult",
  Type: "Item", Brand: "Unbranded", Color: "Multicolor", Material: "Mixed Materials",
  Handmade: "No", Personalize: "No", Personalized: "No",
  "Front Type": "Flat Front", "Fabric Type": "Woven",
};

// ── eBay REST client (token-authed) ──────────────────────────────────────────

interface EbayResp {
  ok: boolean;
  status: number;
  json: any;
  text: string;
}

async function ebayRequest(
  accessToken: string,
  method: string,
  url: string,
  opts: { body?: unknown; extraHeaders?: Record<string, string> } = {}
): Promise<EbayResp> {
  const resp = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      // Node's fetch defaults Accept-Language to "*", which eBay rejects
      // (error 25709). Pin it to a valid locale.
      "Accept-Language": "en-US",
      ...(opts.extraHeaders || {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await resp.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON (e.g. empty 204) */
  }
  return { ok: resp.ok, status: resp.status, json, text };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Price is taken exactly as entered in the app's price field — no automatic
// markup. (Previously this added +18%/$5 on every publish, silently
// overriding whatever price Mark typed before posting.)
function resolvePrice(raw: number | string | undefined): number {
  let base = typeof raw === "string" ? parseFloat(raw) : raw ?? 0;
  if (!base || Number.isNaN(base) || base <= 0) base = 29.99;
  return Math.round(base * 100) / 100;
}

function normalizeConditionInput(value: string | undefined): string {
  const cleaned = (value || "GOOD")
    .trim()
    .toUpperCase()
    .replace(/['’]/g, "")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return CONDITION_ALIASES[cleaned] || "GOOD";
}

function isApparelConditionPolicy(acceptedIds: Set<number>): boolean {
  return acceptedIds.has(2990) || acceptedIds.has(3010);
}

function conditionIdsForGrade(grade: string, acceptedIds: Set<number>): number[] {
  const apparel = isApparelConditionPolicy(acceptedIds);
  const preferences = apparel ? APPAREL_CONDITION_ID_PREFERENCES : GENERAL_CONDITION_ID_PREFERENCES;
  const safeIds = apparel ? APPAREL_SAFE_CONDITION_IDS : GENERAL_SAFE_CONDITION_IDS;
  const preferred = preferences[grade] || preferences.GOOD;

  if (!acceptedIds.size) return preferred;

  const out: number[] = [];
  const add = (id: number) => {
    if (acceptedIds.has(id) && CONDITION_ID_ENUM[id] && !out.includes(id)) out.push(id);
  };
  for (const id of preferred) add(id);
  for (const id of safeIds) add(id);
  for (const id of acceptedIds) add(id);
  return out.length ? out : preferred;
}

// Ordered eBay Inventory condition enums to try for an internal grade. The grade
// comes from photo analysis; the allowed IDs come from the chosen leaf category's
// Metadata policy, so apparel/books/electronics/etc. can each resolve differently.
function conditionCandidates(grade: string | undefined, acceptedIds: Set<number>): string[] {
  const desired = normalizeConditionInput(grade);
  const out: string[] = [];
  for (const id of conditionIdsForGrade(desired, acceptedIds)) {
    const en = CONDITION_ID_ENUM[id];
    if (en && !out.includes(en)) out.push(en);
  }
  return out.length ? out : ["USED_GOOD"];
}

function resolveCategory(listing: ListingResult): {
  categoryId: string;
  fallbacks: string[];
} {
  const explicit = (listing.category_id || "").toString().trim();
  const catKey = (listing.category || "other").toString();
  const mapped = CATEGORY_MAP[catKey] || CATEGORY_MAP.other;
  const categoryId = explicit || mapped;
  const fallbacks = LEAF_FALLBACKS.filter((c) => c && c !== categoryId);
  return { categoryId, fallbacks };
}

// eBay rejects any item-specific (aspect) value longer than this (error 25002).
const MAX_ASPECT_VALUE_LEN = 65;

// Clip an aspect value to eBay's limit, breaking at a word boundary when the
// truncation point lands far enough in to leave a readable phrase.
function clipAspectValue(s: string): string {
  const t = (s || "").trim();
  if (t.length <= MAX_ASPECT_VALUE_LEN) return t;
  const cut = t.slice(0, MAX_ASPECT_VALUE_LEN);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > MAX_ASPECT_VALUE_LEN * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

function singleValue(v: unknown): string {
  if (Array.isArray(v)) {
    for (const x of v) {
      const s = singleValue(x);
      if (s) return s;
    }
    return "";
  }
  let s = String(v ?? "").trim();
  if (!s) return "";
  for (const sep of ["/", ",", "|", "&", " and "]) {
    if (s.includes(sep)) {
      s = s.split(sep)[0].trim();
      break;
    }
  }
  return s.replace(/\s+/g, " ");
}

function departmentForCategory(catKey: string): string {
  if (catKey.startsWith("womens_")) return "Women";
  if (catKey.startsWith("mens_")) return "Men";
  return "Unisex Adult";
}

// Build the item-specifics (aspects) map from the listing.
function buildAspects(listing: ListingResult, catKey: string): Record<string, string[]> {
  const aspects: Record<string, string[]> = {};
  const put = (k: string, v: string) => {
    const val = clipAspectValue(v);
    if (val) aspects[k] = [val];
  };

  put("Brand", String(listing.brand || "").trim());
  put("Size", String(listing.size || "").trim());
  put("Color", singleValue(listing.color));
  put("Material", singleValue(listing.material));
  put("Type", String(listing.item_type || "").trim());

  const feats = Array.isArray(listing.key_features) ? listing.key_features : [];
  const cleanFeats = feats.map((f) => clipAspectValue(String(f))).filter(Boolean).slice(0, 5);
  if (cleanFeats.length) aspects.Features = cleanFeats;

  if (APPAREL_CATEGORIES.has(catKey) || catKey === "accessory") {
    aspects.Department = [departmentForCategory(catKey)];
  }

  // Note: Inseam/Waist Size are populated below from listing.item_specifics
  // (Claude's structured per-field measurement values), not from the
  // free-text `measurements` summary blob — that's a paragraph for buyers,
  // not a single field value, and dumping it into an aspect produces garbage
  // like "Per official Vans Women's Bott..." in dropdown fields.

  // Some aspect names the model might emit aren't real eBay aspects — map
  // them to the correct name instead of creating a stray field eBay ignores.
  const ASPECT_NAME_ALIASES: Record<string, string> = {
    "Front Style": "Front Type",
  };

  // Merge in the model-provided item specifics (skip blanks + section labels).
  for (const [rawKey, v] of Object.entries(listing.item_specifics || {})) {
    if (!rawKey || rawKey.startsWith("---")) continue;
    const k = ASPECT_NAME_ALIASES[rawKey] || rawKey;
    const val = clipAspectValue(singleValue(v));
    if (val && !aspects[k]) aspects[k] = [val];
  }
  return aspects;
}

// ── Required-aspect reconciliation (driven by eBay's Taxonomy data) ──────────
//
// The static defaults above can't know what each leaf category requires, nor
// which values its SELECTION_ONLY aspects accept. We ask eBay for both and make
// every required aspect valid before publishing — eliminating the 25002 errors.

// Match a value against eBay's allowed list, case-insensitively and tolerating
// singular/plural (so "Unisex Adult" resolves to the valid "Unisex Adults").
// Returns the canonical allowed value, or null if there's no match.
// Common size synonyms → canonical eBay value fragments.
// matchAllowed tries exact/plural first, then expands through these aliases.
const SIZE_ALIASES: Record<string, string[]> = {
  "xxs":  ["XXS", "XX-Small", "Extra Extra Small"],
  "xs":   ["XS", "X-Small", "Extra Small"],
  "s":    ["S", "Small"],
  "m":    ["M", "Medium"],
  "l":    ["L", "Large"],
  "xl":   ["XL", "X-Large", "Extra Large"],
  "xxl":  ["XXL", "XX-Large", "2XL", "2X-Large", "Extra Extra Large"],
  "xxxl": ["XXXL", "3XL", "3X-Large"],
  "xxxxl":["XXXXL", "4XL", "4X-Large"],
  "xlt":  ["XLT", "X-Large Tall"],
  "lt":   ["LT", "Large Tall"],
  "mt":   ["MT", "Medium Tall"],
  "st":   ["ST", "Small Tall"],
  "xxlt": ["XXLT", "2XLT"],
  // Spelled-out sizes Claude sometimes returns instead of abbreviations
  "small":         ["S", "Small"],
  "medium":        ["M", "Medium"],
  "large":         ["L", "Large"],
  "extra large":   ["XL", "X-Large", "Extra Large"],
  "extra small":   ["XS", "X-Small", "Extra Small"],
  "xx-large":      ["XXL", "2XL"],
  "x-large":       ["XL", "Extra Large"],
  "x-small":       ["XS", "Extra Small"],
};

function matchAllowed(value: string, allowed: string[]): string | null {
  const ls = (value || "").trim().toLowerCase();
  if (!ls) return null;
  // 1. Exact match (case-insensitive) or simple plural
  for (const v of allowed) {
    const lv = v.toLowerCase();
    if (lv === ls || lv === `${ls}s` || `${lv}s` === ls) return v;
  }
  // 2. Size alias expansion — try each synonym against the allowed list
  const aliases = SIZE_ALIASES[ls] || [];
  for (const alias of aliases) {
    const al = alias.toLowerCase();
    for (const v of allowed) {
      if (v.toLowerCase() === al) return v;
    }
  }
  // 3. Substring match — e.g. "32W" matches "32W x 30L" if nothing else fits
  for (const v of allowed) {
    if (v.toLowerCase().startsWith(ls) || ls.startsWith(v.toLowerCase())) return v;
  }
  return null;
}

// Choose a valid Department from the category's own allowed values, biased by
// the item's gender cues. Kids categories only allow Boys/Girls/Unisex Kids, so
// a blind "Unisex Adults" default would still fail — we match against the list.
function pickDepartment(allowed: string[], listing: ListingResult, catKey: string): string {
  const text = `${catKey} ${listing.title || ""} ${listing.item_type || ""} ${
    listing.item_specifics?.Department || ""
  }`.toLowerCase();
  const women = catKey.startsWith("womens_") || /\b(women|woman|ladies|female|girl)\b/.test(text);
  const men = catKey.startsWith("mens_") || /\b(men|man|male|boy)\b/.test(text);
  const pref = women
    ? ["Women", "Women's", "Girls", "Unisex Adults", "Unisex Kids", "Unisex"]
    : men
      ? ["Men", "Men's", "Boys", "Unisex Adults", "Unisex Kids", "Unisex"]
      : ["Unisex Adults", "Unisex Kids", "Unisex", "Women", "Men"];
  for (const p of pref) {
    const m = matchAllowed(p, allowed);
    if (m) return m;
  }
  return allowed[0] || "";
}

// Best free-text fill for a required aspect we don't already have, drawn from
// the listing itself. eBay accepts any string for FREE_TEXT aspects.
function freeTextDefault(name: string, listing: ListingResult): string {
  const n = name.toLowerCase();
  if (n.includes("brand")) return String(listing.brand || "").trim() || "Unbranded";
  if (n.includes("color")) return singleValue(listing.color) || "Multicolor";
  if (n.includes("shoe size") || n === "size") return String(listing.size || "").trim();
  if (n.includes("material")) return singleValue(listing.material) || "Man Made";
  if (n.includes("style")) return String(listing.item_specifics?.Style || listing.item_type || "").trim();
  if (n.includes("type")) return String(listing.item_type || "").trim();
  return "";
}

// Aspects that should always default to "No" unless the listing explicitly
// says otherwise — the model has no business inventing custom/handmade items.
const FORCE_NO_ASPECTS = new Set(["Handmade", "Personalize", "Personalized"]);

// Make every aspect present in eBay's metadata valid — not just required ones.
// SELECTION_ONLY aspects must always be coerced to an allowed value, whether
// or not eBay marks them required, otherwise the model's free-text guess
// (e.g. "Per official Vans Women's Bott...") gets dumped straight into a
// dropdown field and silently rejected or shown as raw garbage. Mutates
// `aspects` in place.
// Aspects Mark wants always populated for pants, regardless of whether eBay's
// own metadata marks them required for the leaf category.
const ALWAYS_FILL_FOR_PANTS = new Set(["Front Type", "Fabric Type"]);

function reconcileAspects(
  aspects: Record<string, string[]>,
  meta: AspectMeta[],
  listing: ListingResult,
  catKey: string
): void {
  const isPants = PANTS_CATEGORIES.has(catKey) || catKey === "mens_pants" || catKey === "womens_pants";
  for (const a of meta) {
    if (!a.name) continue;
    const current = aspects[a.name]?.[0];
    const mustFill = a.required || (isPants && ALWAYS_FILL_FOR_PANTS.has(a.name));

    // Category gate: if this aspect has a gate and the current category isn't
    // in the allowed set, drop any value the model may have placed there and
    // skip filling a default. Prevents "Hood: No Hood" on dress shirts, etc.
    const gate = ASPECT_CATEGORY_GATES[a.name];
    if (gate && !gate.has(catKey)) {
      // Only drop if the value looks like a default guess, not something the
      // model read directly from the item (e.g. a hoodie correctly flagged
      // even though its leaf category is "mens_top"). Heuristic: drop if the
      // value exactly matches the known default, keep otherwise.
      const isDefaultValue = ASPECT_DEFAULTS[a.name] &&
        (current || "").toLowerCase() === ASPECT_DEFAULTS[a.name].toLowerCase();
      if (isDefaultValue || !current) {
        delete aspects[a.name];
        continue;
      }
      // Model set a non-default value — trust it (e.g. a hoodie top with Hood: Yes).
    }

    // Force Handmade/Personalize to "No" regardless of what the model put there.
    if (FORCE_NO_ASPECTS.has(a.name)) {
      const noValue = matchAllowed("No", a.values) || (a.mode === "SELECTION_ONLY" ? a.values[0] : "No");
      if (noValue) aspects[a.name] = [noValue];
      continue;
    }

    if (a.mode === "SELECTION_ONLY") {
      // Multi-value aspects (e.g. Features) — match each candidate value
      // independently against eBay's allowed list, keep only real matches.
      const currentAll = aspects[a.name] || [];
      if (currentAll.length > 1) {
        const matched = currentAll
          .map((v) => matchAllowed(v, a.values))
          .filter((v): v is string => Boolean(v));
        const unique = Array.from(new Set(matched));
        if (unique.length) {
          aspects[a.name] = unique;
          continue;
        }
      }

      // Must be one of eBay's allowed values, or the publish 25002-fails /
      // a nonsense free-text value gets forced into a dropdown.
      const useDefault = !gate || gate.has(catKey); // only apply default if not gated out
      const canonical =
        matchAllowed(current || "", a.values) ||
        (useDefault ? matchAllowed(ASPECT_DEFAULTS[a.name] || "", a.values) : "") ||
        (a.name === "Department" ? pickDepartment(a.values, listing, catKey) : "") ||
        (mustFill ? a.values[0] : "") ||
        "";
      if (canonical) {
        aspects[a.name] = [canonical];
      } else if (!mustFill && current) {
        delete aspects[a.name];
      }
    } else if (mustFill && !current) {
      const useDefault = !gate || gate.has(catKey);
      const v = freeTextDefault(a.name, listing) || (useDefault ? ASPECT_DEFAULTS[a.name] : "") || a.values[0] || "";
      const clipped = clipAspectValue(v);
      if (clipped) aspects[a.name] = [clipped];
    }
  }
}

// ── eBay error parsing (from the script) ─────────────────────────────────────

function errorIds(r: EbayResp): number[] {
  try {
    return (r.json?.errors || []).map((e: any) => Number(e.errorId || 0));
  } catch {
    return [];
  }
}

function extractExistingOfferId(r: EbayResp): string | null {
  for (const err of r.json?.errors || []) {
    if (err.errorId === 25002) {
      for (const p of err.parameters || []) {
        if (p.name === "offerId") return String(p.value);
      }
    }
  }
  return null;
}

function extractMissingAspects(r: EbayResp): string[] {
  const missing: string[] = [];
  for (const err of r.json?.errors || []) {
    const pieces = [err.message, err.longMessage].concat(
      (err.parameters || []).map((p: any) => String(p.value || ""))
    );
    const hay = pieces.join(" | ");
    const re = /item specific ([^|.,;]+?) is missing/gi;
    let m;
    while ((m = re.exec(hay))) {
      const name = m[1].trim();
      if (name) missing.push(name);
    }
  }
  return missing;
}

function addMissingAspects(
  aspects: Record<string, string[]>,
  missing: string[]
): string[] {
  const added: string[] = [];
  for (const field of missing) {
    const def = ASPECT_DEFAULTS[field] || "Unbranded";
    aspects[field] = [def];
    added.push(`${field}=${def}`);
  }
  return added;
}

function updateOfferBody(offer: Record<string, unknown>): Record<string, unknown> {
  const skip = new Set(["sku", "marketplaceId", "format"]);
  return Object.fromEntries(Object.entries(offer).filter(([k]) => !skip.has(k)));
}

// ── Update price on an already-published listing ──────────────────────────
//
// eBay's Seller Hub quick-edit refuses to touch listings created via the
// Inventory API ("Inventory-based listing management is not currently
// supported by this tool") and tells the seller to use the tool that
// created the listing instead. This is that path: look up the offer by
// SKU, patch just the price, then republish so the live listing reflects it.
export async function updateOfferPrice(
  accessToken: string,
  sku: string,
  newPrice: number
): Promise<{ success: boolean; error?: string }> {
  if (!sku) return { success: false, error: "No SKU provided." };
  if (!Number.isFinite(newPrice) || newPrice <= 0) {
    return { success: false, error: "Price must be a positive number." };
  }

  const lookup = await ebayRequest(
    accessToken,
    "GET",
    `${EBAY_INV_BASE}/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${EBAY_MARKETPLACE_ID}`
  );
  if (!lookup.ok) {
    return { success: false, error: `Could not find eBay offer for SKU ${sku} (${lookup.status}).` };
  }
  const offers: any[] = lookup.json?.offers || [];
  const offer = offers[0];
  if (!offer?.offerId) {
    return { success: false, error: `No eBay offer found for SKU ${sku}.` };
  }

  const body = updateOfferBody({
    ...offer,
    pricingSummary: {
      ...(offer.pricingSummary || {}),
      price: { value: String(newPrice.toFixed(2)), currency: "USD" },
    },
  });

  const upd = await ebayRequest(accessToken, "PUT", `${EBAY_INV_BASE}/offer/${offer.offerId}`, {
    body,
    extraHeaders: CL,
  });
  if (![200, 201, 204].includes(upd.status)) {
    return { success: false, error: `eBay rejected the price update (${upd.status}): ${upd.text.slice(0, 200)}` };
  }

  // If the offer is already published, the update above only changes the
  // draft offer — re-publish so the live listing's price actually changes.
  if (offer.status === "PUBLISHED" || offer.listing?.listingId) {
    const pub = await ebayRequest(
      accessToken,
      "POST",
      `${EBAY_INV_BASE}/offer/${offer.offerId}/publish`,
      { extraHeaders: CL }
    );
    if (!pub.ok) {
      return {
        success: false,
        error: `Price saved but republish failed (${pub.status}): ${pub.text.slice(0, 200)}`,
      };
    }
  }

  return { success: true };
}

// ── Photo upload to eBay Picture Services (Trading API, XML) ──────────────────

async function uploadPhoto(
  accessToken: string,
  base64: string,
  mediaType: string,
  name: string
): Promise<string | null> {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<UploadSiteHostedPicturesRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <PictureName>${name.slice(0, 50)}</PictureName>
  <PictureUploadPolicy>ClearAndNew</PictureUploadPolicy>
</UploadSiteHostedPicturesRequest>`;

  const data = base64.includes(",") ? base64.split(",")[1] : base64;
  const bytes = Buffer.from(data, "base64");
  const form = new FormData();
  form.append("XML Payload", new Blob([xml], { type: "text/xml;charset=utf-8" }), "payload.xml");
  form.append("image", new Blob([new Uint8Array(bytes)], { type: mediaType }), name);

  const resp = await fetch(EBAY_TRADING, {
    method: "POST",
    headers: {
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "967",
      "X-EBAY-API-CALL-NAME": "UploadSiteHostedPictures",
      "X-EBAY-API-IAF-TOKEN": accessToken,
    },
    body: form,
  });
  const text = await resp.text();
  const m = text.match(/<FullURL>([^<]+)<\/FullURL>/);
  return m ? m[1] : null;
}

// ── Policies & location ──────────────────────────────────────────────────────

export interface AccountSetup {
  fulfillmentPolicyId: string;
  paymentPolicyId: string;
  returnPolicyId: string;
  locationKey: string;
}

// The fulfillment policy to use — must match the name in eBay → Account → Business policies.
const FULFILLMENT_POLICY_NAME = "CALCULATED: USPS GAdv, USPS Priority";

function pickFirstPolicy(r: EbayResp, listKey: string, idField: string): string {
  if (!r.ok) return "";
  const list = r.json?.[listKey] || [];
  return list.length ? String(list[0][idField] || "") : "";
}

function pickNamedFulfillmentPolicy(r: EbayResp): string {
  if (!r.ok) return "";
  const list: any[] = r.json?.fulfillmentPolicies || [];
  // Prefer the exact named policy; fall back to first in list.
  const match = list.find((p) => (p.name || "").trim() === FULFILLMENT_POLICY_NAME);
  const chosen = match || list[0];
  return chosen ? String(chosen.fulfillmentPolicyId || "") : "";
}

export async function fetchAccountSetup(accessToken: string): Promise<AccountSetup> {
  const mp = `marketplace_id=${EBAY_MARKETPLACE_ID}`;
  const [ful, pay, ret] = await Promise.all([
    ebayRequest(accessToken, "GET", `${EBAY_ACC_BASE}/fulfillment_policy?${mp}`),
    ebayRequest(accessToken, "GET", `${EBAY_ACC_BASE}/payment_policy?${mp}`),
    ebayRequest(accessToken, "GET", `${EBAY_ACC_BASE}/return_policy?${mp}`),
  ]);
  return {
    fulfillmentPolicyId: pickNamedFulfillmentPolicy(ful),
    paymentPolicyId: pickFirstPolicy(pay, "paymentPolicies", "paymentPolicyId"),
    returnPolicyId: pickFirstPolicy(ret, "returnPolicies", "returnPolicyId"),
    locationKey: await fetchOrCreateLocation(accessToken),
  };
}

async function fetchOrCreateLocation(accessToken: string): Promise<string> {
  const list = await ebayRequest(accessToken, "GET", `${EBAY_INV_BASE}/location`);
  if (list.ok) {
    for (const loc of list.json?.locations || []) {
      if (loc.merchantLocationStatus === "ENABLED" && loc.merchantLocationKey) {
        return loc.merchantLocationKey;
      }
    }
  }
  const key = "HOME_OFFICE";
  const payload = {
    name: "Home Office",
    merchantLocationStatus: "ENABLED",
    locationTypes: ["WAREHOUSE"],
    location: {
      address: {
        // Set EBAY_LOCATION_POSTAL_CODE to your own ZIP. Only used the first
        // time, to create an inventory location if you don't already have one.
        postalCode: process.env.EBAY_LOCATION_POSTAL_CODE || "10001",
        country: "US",
      },
    },
  };
  await ebayRequest(accessToken, "POST", `${EBAY_INV_BASE}/location/${key}`, {
    body: payload,
    extraHeaders: { "Content-Language": "en-US" },
  });
  return key;
}

// ── The full publish flow for one item ───────────────────────────────────────

export interface PublishInput {
  sku: string;
  listing: ListingResult;
  images: { mediaType: string; data: string }[];
}

export interface PublishResult {
  success: boolean;
  sku: string;
  listingId?: string;
  offerId?: string;
  error?: string;
}

const CL = { "Content-Language": "en-US" };

export async function publishListing(
  accessToken: string,
  setup: AccountSetup,
  input: PublishInput
): Promise<PublishResult> {
  const { sku, listing } = input;
  const catKey = String(listing.category || "other");
  const { categoryId: staticCat, fallbacks } = resolveCategory(listing);
  // Ask eBay for the real LEAF category from the title + hint; fall back to the
  // static map only if Taxonomy is unavailable. (Fixes 25005 non-leaf errors.)
  const leaf = await suggestLeafCategory(`${listing.category_hint || ""} ${listing.title || ""}`);
  let catId = leaf || staticCat;

  if (!setup.fulfillmentPolicyId || !setup.paymentPolicyId || !setup.returnPolicyId) {
    return {
      success: false,
      sku,
      error:
        "Your eBay account is missing a business policy (payment, shipping, or returns). Set these up in eBay → Account → Business policies, then try again.",
    };
  }

  // 1. Upload photos → EPS URLs.
  const photoList = [...input.images.slice(0, 12)];
  const photoUrls: string[] = [];
  for (const img of photoList) {
    const url = await uploadPhoto(accessToken, img.data, img.mediaType, `${sku}.jpg`);
    if (url) photoUrls.push(url);
  }
  if (photoUrls.length === 0) {
    return { success: false, sku, error: "Could not upload any photos to eBay." };
  }

  // ── SAFETY: refuse to overwrite an existing live eBay listing ────────────
  // The client-side guard only catches duplicates within the current batch.
  // This server-side check catches cross-batch collisions (e.g. a SKU used in
  // a previous session that was already cleared from the app's UI). If the SKU
  // already has a PUBLISHED offer on eBay, overwriting the inventory item would
  // silently replace the original listing's photos/title/data and lose it.
  const existingOfferCheck = await ebayRequest(
    accessToken,
    "GET",
    `${EBAY_INV_BASE}/offer?sku=${encodeURIComponent(sku)}&marketplace_id=${EBAY_MARKETPLACE_ID}`
  );
  if (existingOfferCheck.ok) {
    const existingOffers: any[] = existingOfferCheck.json?.offers || [];
    const liveOffer = existingOffers.find((o) => o.status === "PUBLISHED");
    if (liveOffer) {
      const listingId = liveOffer.listing?.listingId;
      return {
        success: false,
        sku,
        error:
          `SKU "${sku}" is already live on eBay` +
          (listingId ? ` (listing #${listingId})` : "") +
          `. Choose a different SKU for this item — posting with a duplicate SKU would overwrite and destroy the existing listing.`,
      };
    }
  }

  // 2. Inventory item.
  const aspects = buildAspects(listing, catKey);
  // Ask eBay (in parallel) for the leaf category's REQUIRED specifics and its
  // accepted condition ids, then make both valid before creating the item.
  // Non-fatal: the recovery loops below remain as a backup if eBay is slow.
  let acceptedConds = new Set<number>();
  try {
    const [meta, conds] = await Promise.all([
      categoryAspects(catId), // required aspects + valid values  → fixes 25002
      acceptedConditionIds(catId), // accepted condition ids       → fixes 25021
    ]);
    if (meta.length) reconcileAspects(aspects, meta, listing, catKey);
    acceptedConds = conds;
  } catch {
    /* taxonomy/metadata unavailable — proceed with best-effort values */
  }
  const condCandidates = conditionCandidates(listing.condition, acceptedConds);
  const condition = condCandidates[0] || "USED_EXCELLENT";
  // Build packageWeightAndSize from the listing's estimated shipping data.
  // eBay requires weight for most categories (error 25020 if missing).
  const weightOz = listing.shipping_weight_oz ?? 16; // default 1 lb if not estimated
  const lbs = Math.floor(weightOz / 16);
  const oz = weightOz % 16;
  const dims = listing.shipping_dimensions;
  const packageWeightAndSize: any = {
    weight: { value: lbs + oz / 16, unit: "POUND" },
    packageType: dims && dims.height <= 1 ? "LETTER" : "PACKAGE_THICK_ENVELOPE",
  };
  if (dims) {
    packageWeightAndSize.dimensions = {
      length: dims.length,
      width: dims.width,
      height: dims.height,
      unit: "INCH",
    };
  }

  // ── Title enforcement ─────────────────────────────────────────────────────
  // Protocol requires 77-80 characters. If Claude undershot, pad with the most
  // useful available keywords before the title hits eBay.
  // NEVER append generic fallbacks like "Shirt" or "Mens" — they produce
  // nonsense titles (e.g. "AG Wanderer Shorts ... Mens Shirt").
  // Only pad with data that is actually known about this specific item.

  // Normalize item_type pluralization — "Short" → "Shorts", "Pant" → "Pants" etc.
  // eBay buyers search plural forms; singular misses those queries entirely.
  // Normalize title tokens for maximum Cassini search coverage:
  // - Remove apostrophes from gendered possessives (Men's → Mens, Women's → Womens)
  //   Buyers rarely type apostrophes on mobile; "Mens" has higher search volume.
  // - Pluralize item types (Short → Shorts, Pant → Pants, etc.)
  const normalizeTitle = (t: string): string =>
    t
      // Gender normalization — apostrophe removal
      .replace(/Men's/gi, "Mens")
      .replace(/Women's/gi, "Womens")
      .replace(/Kid's/gi, "Kids")
      .replace(/Boy's/gi, "Boys")
      .replace(/Girl's/gi, "Girls")
      // Standalone "Men" → "Mens", "Women" → "Womens" (stronger gender signal)
      .replace(/Men(?!s)/g, "Mens")
      .replace(/Women(?!s)/g, "Womens")
      // Item type pluralization
      .replace(/Short(?!s)/g, "Shorts")
      .replace(/Pant(?!s)/g, "Pants")
      .replace(/Jean(?!s)/g, "Jeans")
      .replace(/Sock(?!s)/g, "Socks")
      .replace(/Shoe(?!s)/g, "Shoes")
      .replace(/Glove(?!s)/g, "Gloves");

  const normalizeItemType = (t: string): string => normalizeTitle(t);

  let ebayTitle = normalizeTitle(String(listing.title || "Untitled").trim()).slice(0, 80);

  // Strip any retail price under $90 from the title — low prices waste keyword
  // space and signal low value. Only $90+ retail prices are worth the characters.
  ebayTitle = ebayTitle.replace(/\s*\$(\d+(?:\.\d{2})?)\s*(?:retail|msrp|NWT)?/gi, (match, amount) => {
    const price = parseFloat(amount);
    return price >= 90 ? match : "";
  }).replace(/\s{2,}/g, " ").trim().slice(0, 80);
  if (ebayTitle.length < 77) {
    // Candidate padding tokens — item-specific only, in priority order.
    // Each token is only added if it isn't already present in the title.
    const itemType = listing.item_type ? normalizeItemType(String(listing.item_type).trim()) : null;
    const padCandidates = [
      listing.condition === "NEW_WITH_TAGS" || listing.condition === "NEW_NO_TAGS" ? "NWT" : null,
      listing.size ? String(listing.size).trim() : null,
      listing.color ? singleValue(listing.color) : null,
      listing.material ? singleValue(listing.material) : null,
      itemType,
      listing.brand ? String(listing.brand).trim() : null,
    ].filter((t): t is string => t !== null && t !== undefined && !ebayTitle.toLowerCase().includes(t.toLowerCase()));

    for (const token of padCandidates) {
      const candidate = `${ebayTitle} ${token}`;
      if (candidate.length <= 80) {
        ebayTitle = candidate;
        if (ebayTitle.length >= 77) break;
      }
    }
  }

  const inventoryItem: any = {
    product: {
      title: ebayTitle,
      description: listing.description || "",
      aspects,
      imageUrls: photoUrls.slice(0, 12),
    },
    condition,
    conditionDescription: listing.condition_notes || "",
    availability: { shipToLocationAvailability: { quantity: 1 } },
    packageWeightAndSize,
  };

  const putInventory = () =>
    ebayRequest(accessToken, "PUT", `${EBAY_INV_BASE}/inventory_item/${sku}`, {
      body: inventoryItem,
      extraHeaders: CL,
    });

  let r = await putInventory();
  if (![200, 201, 204].includes(r.status)) {
    const missing = extractMissingAspects(r);
    if (missing.length && addMissingAspects(aspects, missing).length) {
      inventoryItem.product.aspects = aspects;
      r = await putInventory();
    }
    // Recovery: condition invalid for this category (25021/25059) → step down
    // to a grade the category accepts.
    if (
      ![200, 201, 204].includes(r.status) &&
      (errorIds(r).includes(25021) || errorIds(r).includes(25059))
    ) {
      for (const alt of condCandidates) {
        if (alt === inventoryItem.condition) continue;
        inventoryItem.condition = alt;
        r = await putInventory();
        if ([200, 201, 204].includes(r.status)) break;
        if (!errorIds(r).includes(25021) && !errorIds(r).includes(25059)) break;
      }
    }
    if (![200, 201, 204].includes(r.status)) {
      return { success: false, sku, error: `Inventory item failed (${r.status}): ${r.text.slice(0, 300)}` };
    }
  }

  // 3. Offer.
  const price = resolvePrice(listing.suggested_price);

  // Apply a 3% promoted listing rate for high-competition brands and clothing
  // categories where many similar items compete (Polo shorts, Tommy Bahama
  // shirts, etc.). Promoted listings boost visibility in eBay search above
  // organic rank for a small percentage of the final sale price.
  const PROMOTED_BRANDS = new Set([
    "polo ralph lauren", "tommy bahama", "peter millar", "faherty", "hugo boss",
    "psycho bunny", "lacoste", "rhone", "johnnie-o", "southern tide",
    "travis mathew", "travismathew", "brooks brothers", "burberry", "zegna",
    "armani", "lacoste", "vineyard vines", "patagonia", "orvis", "pendleton",
    "columbia", "the north face", "under armour", "nike", "adidas",
  ]);
  const PROMOTED_CATEGORIES = new Set([
    "mens_top", "mens_pants", "mens_shorts", "mens_jacket", "mens_coat",
    "mens_sweater", "mens_jeans", "womens_top", "womens_pants", "womens_jacket",
  ]);
  const brandLower = String(listing.brand || "").toLowerCase().trim();
  const isPromoted =
    PROMOTED_BRANDS.has(brandLower) || PROMOTED_CATEGORIES.has(catKey);

  const offerBody: any = {
    sku,
    marketplaceId: EBAY_MARKETPLACE_ID,
    format: "FIXED_PRICE",
    listingDescription: listing.description || "",
    pricingSummary: { price: { value: String(price), currency: "USD" } },
    quantityLimitPerBuyer: 1,
    categoryId: catId,
    merchantLocationKey: setup.locationKey,
    listingPolicies: {
      fulfillmentPolicyId: setup.fulfillmentPolicyId,
      paymentPolicyId: setup.paymentPolicyId,
      returnPolicyId: setup.returnPolicyId,
      ...(isPromoted
        ? {
            promotedListingPolicy: {
              bidPercentage: "3.0",
              campaignId: undefined, // eBay auto-assigns to default campaign
            },
          }
        : {}),
    },
    includeCatalogProductDetails: false,
    // Custom label = SKU so it appears and is editable in Seller Hub
    storeFront: { customLabel: sku },
  };

  const postOffer = () =>
    ebayRequest(accessToken, "POST", `${EBAY_INV_BASE}/offer`, { body: offerBody, extraHeaders: CL });

  r = await postOffer();

  // Recovery: missing aspects during offer create.
  if (![200, 201].includes(r.status) && extractMissingAspects(r).length) {
    if (addMissingAspects(aspects, extractMissingAspects(r)).length) {
      inventoryItem.product.aspects = aspects;
      await putInventory();
      r = await postOffer();
    }
  }
  // Recovery: non-leaf category (25005).
  if (![200, 201].includes(r.status) && errorIds(r).includes(25005)) {
    for (const fb of fallbacks) {
      offerBody.categoryId = fb;
      const fbResp = await postOffer();
      if ([200, 201].includes(fbResp.status) || extractExistingOfferId(fbResp)) {
        r = fbResp;
        catId = fb;
        break;
      }
    }
  }

  let offerId: string;
  if (r.status === 400) {
    const existing = extractExistingOfferId(r);
    if (!existing) {
      return { success: false, sku, error: `Offer creation failed (${r.status}): ${r.text.slice(0, 300)}` };
    }
    // Update the pre-existing offer instead.
    const upd = await ebayRequest(accessToken, "PUT", `${EBAY_INV_BASE}/offer/${existing}`, {
      body: updateOfferBody(offerBody),
      extraHeaders: CL,
    });
    if (![200, 201, 204].includes(upd.status)) {
      return { success: false, sku, error: `Offer update failed (${upd.status}): ${upd.text.slice(0, 300)}` };
    }
    offerId = existing;
  } else if (![200, 201].includes(r.status)) {
    return { success: false, sku, error: `Offer creation failed (${r.status}): ${r.text.slice(0, 300)}` };
  } else {
    offerId = r.json?.offerId || "";
  }

  // 4. Publish, with recovery.
  return publishOfferWithRecovery(accessToken, {
    sku,
    offerId,
    catId,
    catKey,
    aspects,
    inventoryItem,
    offerBody,
    fallbacks,
    condCandidates,
  });
}

async function publishOfferWithRecovery(
  accessToken: string,
  ctx: {
    sku: string;
    offerId: string;
    catId: string;
    catKey: string;
    aspects: Record<string, string[]>;
    inventoryItem: any;
    offerBody: any;
    fallbacks: string[];
    condCandidates: string[];
  }
): Promise<PublishResult> {
  const { sku, offerId } = ctx;
  const doPublish = () =>
    ebayRequest(accessToken, "POST", `${EBAY_INV_BASE}/offer/${offerId}/publish`, {
      extraHeaders: CL,
    });
  const putInventory = () =>
    ebayRequest(accessToken, "PUT", `${EBAY_INV_BASE}/inventory_item/${sku}`, {
      body: ctx.inventoryItem,
      extraHeaders: CL,
    });

  let r = await doPublish();
  if (r.ok) return { success: true, sku, offerId, listingId: r.json?.listingId || "" };

  let eids = errorIds(r);

  // Recovery: missing item specifics.
  const missing = extractMissingAspects(r);
  if (missing.length && addMissingAspects(ctx.aspects, missing).length) {
    ctx.inventoryItem.product.aspects = ctx.aspects;
    await putInventory();
    r = await doPublish();
    if (r.ok) return { success: true, sku, offerId, listingId: r.json?.listingId || "" };
    eids = errorIds(r);
  }

  // Recovery: invalid condition (25059/25021) → step through the remaining
  // candidate grades until one publishes.
  if (eids.includes(25059) || eids.includes(25021)) {
    for (const alt of ctx.condCandidates) {
      if (alt === ctx.inventoryItem.condition) continue;
      ctx.inventoryItem.condition = alt;
      await putInventory();
      r = await doPublish();
      if (r.ok) return { success: true, sku, offerId, listingId: r.json?.listingId || "" };
      eids = errorIds(r);
      if (!eids.includes(25021) && !eids.includes(25059)) break;
    }
  }

  // Recovery: non-leaf category (25005) → try fallbacks via offer update.
  if (eids.includes(25005)) {
    for (const fb of ctx.fallbacks) {
      const upd = await ebayRequest(accessToken, "PUT", `${EBAY_INV_BASE}/offer/${offerId}`, {
        body: { ...updateOfferBody(ctx.offerBody), categoryId: fb },
        extraHeaders: CL,
      });
      if ([200, 201, 204].includes(upd.status)) {
        r = await doPublish();
        if (r.ok) return { success: true, sku, offerId, listingId: r.json?.listingId || "" };
      }
    }
  }

  return {
    success: false,
    sku,
    offerId,
    error: `Publish failed (${r.status}): ${r.text.slice(0, 300)}`,
  };
}






