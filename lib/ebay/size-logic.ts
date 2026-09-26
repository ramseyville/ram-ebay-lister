// lib/ebay/size-logic.ts
//
// Every function here is a pure function of its inputs — no network calls,
// no side effects — which is exactly what makes this extractable and
// testable on its own. This module holds the size/category-detection logic
// that was responsible for nearly every real bug found during one long
// debugging session: a regex with no boundary that mangled "3XL" into "3",
// a Size Type default that got silently rejected, a waist-extraction
// pattern that only fired for an exact category match instead of
// recognizing "29x31" on sight. Splitting this out of the 2,400+ line
// publish.ts, and building a real test suite directly against it, is the
// concrete fix for how those bugs went undetected for as long as they did:
// a future change to any of this can now be checked against every known
// edge case automatically, rather than only against whatever one case is
// directly in front of it at the time.

import type { ListingResult } from "@/lib/types";

export const APPAREL_CATEGORIES = new Set([
  "womens_top", "womens_dress", "womens_skirt", "womens_pants", "womens_coat",
  "womens_sweater", "womens_jeans", "womens_clothing", "womens_shoes", "mens_top",
  "mens_pants", "mens_coat", "mens_sweater", "mens_jeans", "mens_clothing",
  "mens_shoes", "scarf", "belt", "hat", "mens_polo", "womens_polo",
  "mens_casual_shirt", "mens_tshirt",
]);

export const PANTS_CATEGORIES = new Set([
  "womens_pants", "womens_jeans", "womens_skirt", "mens_pants", "mens_jeans",
]);

export const TOPS_CATEGORIES = new Set([
  "mens_top", "womens_top", "mens_sweater", "womens_sweater", "mens_clothing", "womens_clothing",
  "mens_polo", "womens_polo", "mens_casual_shirt", "mens_tshirt",
]);

export const SIZE_ENFORCED_CATEGORIES = new Set([
  "mens_top", "mens_pants", "mens_shorts", "mens_jacket", "mens_coat",
  "mens_sweater", "mens_jeans", "mens_shoes", "mens_clothing", "mens_polo",
  "womens_top", "womens_pants", "womens_jacket", "womens_coat",
  "womens_sweater", "womens_jeans", "womens_dress", "womens_skirt",
  "womens_shoes", "womens_clothing", "womens_polo",
  "mens_casual_shirt", "mens_tshirt",
]);

export function cleanSizeBase(rawSize: string): string {
  let base = (rawSize || "").trim();
  base = base.replace(/\s*\([^)]*\)\s*$/, ""); // strip parenthetical explanations
  if (/^O\/?S$/i.test(base)) return base; // "O/S" isn't bilingual — leave it alone here
  base = base.split("/")[0].trim(); // strip bilingual/dual-notation second half
  return base;
}

export function sizeParts(rawSize: string): string[] {
  const raw = (rawSize || "").trim();
  // The parenthetical is usually just an explanation safe to drop when
  // picking a VALUE to submit ("XLT (XL Tall)" — the code alone is enough).
  // But for DETECTION it can be the only place a signal appears at all
  // ("18 1/2 - 36/37 (Big Man)" has no other hint of "Big" anywhere) — so
  // it gets checked as its own part rather than discarded.
  const parenMatch = /\(([^)]*)\)\s*$/.exec(raw);
  const withoutParen = raw.replace(/\s*\([^)]*\)\s*$/, "");
  const mainParts = withoutParen.split("/").map((p) => p.trim()).filter(Boolean);
  return parenMatch && parenMatch[1].trim() ? [...mainParts, parenMatch[1].trim()] : mainParts;
}

export function isExtendedSize(rawSize: string): boolean {
  return sizeParts(rawSize).some((part) => {
    const s = part.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!s) return false;
    if (/\d+X/.test(s)) return true; // "2X", "3XL", "4X"... any digit+X
    if (/X{2,}/.test(s)) return true; // "XXL", "XXXL"... repeated X
    if (/^(ST|MT|LT)$/.test(s)) return true; // bare tall codes
    if (/X+LT$/.test(s)) return true; // "XLT", "2XLT"... tall-with-X codes
    if (/BIG/.test(s)) return true; // "Big..." prefix OR "(Big Man)" mid-string
    if (/TALL/.test(s)) return true; // the word, anywhere
    if (/^P/.test(s) || /P$/.test(s)) return true; // petite markers
    if (/^\d{2,3}W/.test(s)) return true; // women's numeric plus ("16W")
    return false;
  });
}

export function sizeTypeCandidates(rawSize: string, catKey: string): string[] {
  const parts = sizeParts(rawSize).map((p) => p.toUpperCase().replace(/[^A-Z0-9]/g, ""));
  if (!parts.length) return ["Regular"];
  const isWomens = catKey.startsWith("womens_");

  if (isWomens) {
    // The W suffix is REQUIRED here, not optional — confirmed via a real
    // rejection: bare "14" (no W) is a standard size, not plus, and eBay
    // correctly rejected "Plus" paired with it. Only the explicit W variant
    // (14W, 16W...) is genuinely plus-size; a bare two-digit number in this
    // range is not.
    if (parts.some((p) => /^[1-6]X$/.test(p) || /^(1[4-9]|[2-9]\d)W$/.test(p))) return ["Plus"];
    // Confirmed via live eBay category facets ("Petites · Petites") that
    // the real Size Type value is plural — "Petite" (singular) was
    // rejected outright on a real listing.
    if (parts.some((p) => /^P/.test(p) || /P$/.test(p))) return ["Petites"];
    return ["Regular"];
  }

  const isBigPattern = parts.some((p) => /^X{2,}L?B?$/.test(p) || /^[2-6]XL?B?$/.test(p));
  const isTallPattern = parts.some((p) => /^(ST|MT|LT|X+LT|[2-6]XLT)$/.test(p));
  // "3XT" (3X-Tall) and "4XB" (4X-Big) — the "L"-less abbreviation style,
  // distinct from both "NXLT"/"NXLB" and bare "NX".
  const isTallAbbrev = parts.some((p) => /^\dXT$/.test(p));
  const isBigAbbrev = parts.some((p) => /^\dXB$/.test(p));
  const hasBig = parts.some((p) => /BIG/.test(p));
  const hasTall = parts.some((p) => /TALL/.test(p));

  // Tall-coded items (XLT, 2XLT...) genuinely pair with either "Tall" or
  // "Big & Tall" depending on category — try both.
  if (isTallPattern || isTallAbbrev || hasTall) return ["Tall", "Big & Tall"];
  if (isBigPattern || isBigAbbrev || hasBig) return ["Big & Tall", "Tall"];

  const isPantsCat =
    PANTS_CATEGORIES.has(catKey) || catKey === "mens_pants" || catKey === "mens_jeans" || catKey === "mens_shorts";
  if (isPantsCat) {
    const waistMatch = parts[0]?.match(/^(\d{2})/);
    if (waistMatch && parseInt(waistMatch[1], 10) >= 44) return ["Big & Tall", "Tall"];
  }
  return ["Regular"];
}

export function inferSizeType(rawSize: string, catKey: string): string {
  return sizeTypeCandidates(rawSize, catKey)[0];
}

export function normalizeExtendedSize(size: string): string {
  const m = /^([2-9])X$/i.exec((size || "").trim());
  return m ? `${m[1]}XL` : size;
}

export function sizeCandidates(rawSize: string, catKey: string): string[] {
  const base0 = cleanSizeBase(rawSize);

  // "O/S" (One Size) has a slash too, but it's an abbreviation, not
  // bilingual dual-notation — cleanSizeBase already leaves it untouched;
  // recognize it here before treating it as a normal code.
  if (/^O\/?S$/i.test(base0)) {
    return ["One Size", "OS", "O/S"];
  }

  const base = base0;

  // Detect the pattern itself rather than gate on category classification.
  // A string like "29x31" is unambiguous — that format only ever means
  // waist-by-inseam, regardless of what category the AI happened to
  // assign. Gating this behind an exact catKey match was the actual bug:
  // if classification landed on anything other than the few expected
  // pants values (the same kind of miscategorization that sent a sweater
  // to "Casual Button-Down Shirts" earlier tonight), this extraction never
  // ran at all, and the raw combined string went to eBay unchanged.
  const waistInseamMatch = /^(\d{2,3})\s*[xX]\s*\d{2,3}/.exec(base);
  if (waistInseamMatch) return [waistInseamMatch[1]];

  const out: string[] = [];
  const push = (v: string) => {
    if (v && !out.includes(v)) out.push(v);
  };

  // Push transforms FIRST, raw base LAST — matching order doesn't affect
  // whether a real value gets found (every candidate gets tried either
  // way), but it does determine what sizeAspectValue() picks as its single
  // best guess when there's nothing real to check against. The raw brand
  // code ("3XLB") is the least likely of the options to be a real eBay
  // value, so it shouldn't be candidates[0].
  let m = /^(\d)XLB?$/i.exec(base);
  if (m) {
    push(`${m[1]}XL`);
    push(`Big ${m[1]}X`);
    push(`${m[1]}X`);
  }
  m = /^(\d)X$/i.exec(base);
  if (m) {
    push(`${m[1]}XL`);
    push(`Big ${m[1]}X`);
  }
  // "3XT" (3X-Tall, no "L") and "4XB" (4X-Big, no "L") — a third
  // abbreviation style, distinct from both "NXLT"/"NXLB" and bare "NX".
  m = /^(\d)XT$/i.exec(base);
  if (m) {
    push(`${m[1]}XLT`);
  }
  m = /^(\d)XB$/i.exec(base);
  if (m) {
    push(`${m[1]}XL`);
    push(`Big ${m[1]}X`);
    push(`${m[1]}X`);
  }
  push(base);
  return out;
}

export function looksLikeSizeCode(cleaned: string): boolean {
  if (!cleaned) return false;
  if (/\d/.test(cleaned)) return true;
  if (/^X{0,4}(S|L)$/.test(cleaned) || cleaned === "M" || cleaned === "OS") return true;
  return false;
}

export function sizeAspectValue(rawSize: string, catKey: string): string {
  const candidates = sizeCandidates(rawSize, catKey);
  const best = candidates[0] || (rawSize || "").trim();
  const cleaned = best.toUpperCase().replace(/[^A-Z0-9]/g, "");
  // Not a real size code (e.g. "Big Man") — don't submit it. Better to
  // leave the field for eBay's own required-field fallback to pick SOME
  // valid option than guarantee a rejection with text that was never a
  // size code in the first place. The actual size can be corrected on the
  // live listing afterward once the real number is known.
  return looksLikeSizeCode(cleaned) ? best : "";
}

export function isFragranceItem(listing: ListingResult): boolean {
  const titleUpper = String(listing.title || "").toUpperCase();
  return /\b(COLOGNE|PERFUME|EAU DE (TOILETTE|PARFUM|COLOGNE)|EDT|EDP|FRAGRANCE|AFTERSHAVE|AFTER SHAVE|BODY SPRAY)\b/.test(
    titleUpper
  );
}

