// Condition grading shared by the AI prompt, the listing UI, and eBay publish.
//
// The model (or the seller, via the UI) picks a GRADE from the photos and
// notes. At publish time the grade is resolved to a numeric eBay condition ID
// that the listing's leaf category actually accepts (from conditionPolicy()),
// stepping to the closest valid ID when the preferred one isn't allowed. The
// buyer-facing condition text is then rebuilt from the ID that was actually
// used, so it can never disagree with the condition eBay shows.
//
// Pure module — no server imports — so the client can use it too.

export type ConditionGrade =
  | "NEW_WITH_TAGS"
  | "NEW_NO_TAGS"
  | "NEW_WITH_DEFECTS"
  | "EXCELLENT"
  | "GOOD"
  | "FAIR";

// Grades in display order, with the apparel condition ID each maps to (the
// IDs clothing leaves like 57991/11554 accept) and the rule the model grades by.
export const CONDITION_GRADES: { grade: ConditionGrade; id: number; rule: string }[] = [
  { grade: "NEW_WITH_TAGS", id: 1000, rule: "unworn with original tags attached" },
  { grade: "NEW_NO_TAGS", id: 1500, rule: "unworn and flawless, but no original tags" },
  { grade: "NEW_WITH_DEFECTS", id: 1750, rule: "unworn/new (tags may be present) but with a visible defect, store mark, or flaw" },
  { grade: "EXCELLENT", id: 2990, rule: "pre-owned with no visible wear" },
  { grade: "GOOD", id: 3000, rule: "pre-owned with light, normal wear" },
  { grade: "FAIR", id: 3010, rule: "pre-owned with noticeable flaws (stains, holes, pilling, fading, damage)" },
];

// eBay Inventory API condition enums by numeric condition ID.
export const CONDITION_ID_ENUM: Record<number, string> = {
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

const ENUM_TO_ID: Record<string, number> = Object.fromEntries(
  Object.entries(CONDITION_ID_ENUM).map(([id, en]) => [en, Number(id)])
);

// eBay's own names. Apparel leaves rename the shared IDs (3000 is "Used" in
// most categories but "Pre-owned - Good" in clothing). Used when the live
// policy lookup didn't supply a name.
const CONDITION_NAMES: Record<number, { apparel: string; general: string }> = {
  1000: { apparel: "New with tags", general: "New" },
  1500: { apparel: "New without tags", general: "New other (see details)" },
  1750: { apparel: "New with imperfections", general: "New with defects" },
  2750: { apparel: "Like New", general: "Like New" },
  2990: { apparel: "Pre-owned - Excellent", general: "Pre-owned - Excellent" },
  3000: { apparel: "Pre-owned - Good", general: "Used" },
  3010: { apparel: "Pre-owned - Fair", general: "Pre-owned - Fair" },
  4000: { apparel: "Very Good", general: "Very Good" },
  5000: { apparel: "Good", general: "Good" },
  6000: { apparel: "Acceptable", general: "Acceptable" },
  7000: { apparel: "For parts or not working", general: "For parts or not working" },
};

// The grading standard stated to buyers for each condition ID.
const CONDITION_STANDARDS: Record<number, { apparel: string; general: string }> = {
  1000: {
    apparel: "New with original tags attached. Never worn.",
    general: "Brand new and unused.",
  },
  1500: {
    apparel: "New and unworn, without original tags. No flaws.",
    general: "New and unused; may be missing original packaging.",
  },
  1750: {
    apparel: "New and unworn, with minor imperfections noted below.",
    general: "New and unused, with minor imperfections noted below.",
  },
  2750: { apparel: "Like new, with no visible signs of use.", general: "Like new, with no visible signs of use." },
  2990: { apparel: "No visible signs of wear.", general: "No visible signs of wear." },
  3000: {
    apparel: "Light, normal signs of wear. No significant flaws.",
    general: "Previously used; see details below.",
  },
  3010: {
    apparel: "Noticeable wear or flaws, detailed below.",
    general: "Noticeable wear or flaws, detailed below.",
  },
  4000: { apparel: "Minimal signs of use. No significant flaws.", general: "Minimal signs of use. No significant flaws." },
  5000: { apparel: "Light, normal signs of use.", general: "Light, normal signs of use." },
  6000: { apparel: "Noticeable wear or flaws, detailed below.", general: "Noticeable wear or flaws, detailed below." },
  7000: {
    apparel: "Sold as-is for parts or repair; not fully functional.",
    general: "Sold as-is for parts or repair; not fully functional.",
  },
};

const CONDITION_ALIASES: Record<string, ConditionGrade> = {
  NEW: "NEW_WITH_TAGS",
  NWT: "NEW_WITH_TAGS",
  NEW_WITH_TAGS: "NEW_WITH_TAGS",
  NEW_WITH_BOX: "NEW_WITH_TAGS",
  NEW_WITHOUT_TAGS: "NEW_NO_TAGS",
  NEW_WITHOUT_BOX: "NEW_NO_TAGS",
  NEW_NO_TAGS: "NEW_NO_TAGS",
  NWOT: "NEW_NO_TAGS",
  NEW_OTHER: "NEW_NO_TAGS",
  OPEN_BOX: "NEW_NO_TAGS",
  NEW_WITH_DEFECTS: "NEW_WITH_DEFECTS",
  NEW_WITH_IMPERFECTIONS: "NEW_WITH_DEFECTS",
  LIKE_NEW: "EXCELLENT",
  EXCELLENT: "EXCELLENT",
  PREOWNED_EXCELLENT: "EXCELLENT",
  PRE_OWNED_EXCELLENT: "EXCELLENT",
  // USED_EXCELLENT is eBay's enum for ID 3000 — "Pre-owned - Good" in
  // apparel — so it round-trips to GOOD, not EXCELLENT.
  USED_EXCELLENT: "GOOD",
  // Legacy grade from before the Excellent/Good/Fair scale; apparel has no
  // Very Good tier and always published it as 3000.
  VERY_GOOD: "GOOD",
  USED_VERY_GOOD: "GOOD",
  PREOWNED_VERY_GOOD: "GOOD",
  PRE_OWNED_VERY_GOOD: "GOOD",
  GOOD: "GOOD",
  USED: "GOOD",
  PREOWNED: "GOOD",
  PRE_OWNED: "GOOD",
  USED_GOOD: "GOOD",
  PREOWNED_GOOD: "GOOD",
  PRE_OWNED_GOOD: "GOOD",
  FAIR: "FAIR",
  ACCEPTABLE: "FAIR",
  USED_ACCEPTABLE: "FAIR",
  PREOWNED_FAIR: "FAIR",
  PRE_OWNED_FAIR: "FAIR",
  USED_FAIR: "FAIR",
  FOR_PARTS_OR_NOT_WORKING: "FAIR",
};

// Preferred IDs per grade, closest first. Apparel ladders use the clothing
// IDs; general ladders the classic Used/Very Good/Good/Acceptable scale.
// Fallbacks step DOWN before up so a missing tier never overgrades an item.
const APPAREL_LADDERS: Record<ConditionGrade, number[]> = {
  NEW_WITH_TAGS: [1000, 1500, 1750],
  NEW_NO_TAGS: [1500, 1000, 1750],
  NEW_WITH_DEFECTS: [1750, 1500, 2990, 3000],
  EXCELLENT: [2990, 3000, 3010],
  GOOD: [3000, 3010, 2990],
  FAIR: [3010, 3000],
};

const GENERAL_LADDERS: Record<ConditionGrade, number[]> = {
  NEW_WITH_TAGS: [1000, 1500, 1750],
  NEW_NO_TAGS: [1500, 1000, 1750],
  NEW_WITH_DEFECTS: [1750, 1500, 2750, 3000],
  EXCELLENT: [3000, 2750, 4000, 5000],
  GOOD: [5000, 4000, 3000, 6000],
  FAIR: [6000, 5000, 4000, 3000],
};

function cleanToken(value: string | undefined): string {
  return (value || "")
    .trim()
    .toUpperCase()
    .replace(/['’]/g, "")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Map any grade/alias/eBay enum to one of the six grades (GOOD if unknown). */
export function normalizeConditionGrade(value: string | undefined): ConditionGrade {
  return CONDITION_ALIASES[cleanToken(value)] || "GOOD";
}

/**
 * The exact eBay condition ID when the value is already an eBay enum (a
 * listing rebuilt from eBay data) or a bare numeric ID; otherwise null.
 */
export function exactConditionId(value: string | undefined): number | null {
  const token = cleanToken(value);
  if (/^\d{4}$/.test(token) && CONDITION_ID_ENUM[Number(token)]) return Number(token);
  // "NEW" as a bare value is our NWT alias, which resolves to 1000 anyway.
  return ENUM_TO_ID[token] ?? null;
}

/** True when a category's accepted IDs are the apparel (Pre-owned tier) set. */
export function isApparelConditionSet(acceptedIds: Set<number>): boolean {
  return acceptedIds.has(2990) || acceptedIds.has(3010);
}

/**
 * Ordered eBay condition IDs to try for a grade. With a known accepted set,
 * only accepted IDs are returned: the grade's ladder first, then any other
 * accepted ID by numeric closeness to the preferred one. With no accepted set
 * (lookup failed), both ladders are returned unvalidated so publish-time
 * recovery can step through them on an eBay rejection.
 */
export function conditionIdCandidates(
  value: string | undefined,
  acceptedIds: Set<number>,
  apparelHint: boolean
): number[] {
  const grade = normalizeConditionGrade(value);
  const apparel = acceptedIds.size ? isApparelConditionSet(acceptedIds) : apparelHint;
  const exact = exactConditionId(value);
  const ladder = [
    ...(exact ? [exact] : []),
    ...(apparel ? APPAREL_LADDERS : GENERAL_LADDERS)[grade],
  ];
  const out: number[] = [];
  const add = (id: number) => {
    if (CONDITION_ID_ENUM[id] && !out.includes(id)) out.push(id);
  };

  if (!acceptedIds.size) {
    ladder.forEach(add);
    (apparel ? GENERAL_LADDERS : APPAREL_LADDERS)[grade].forEach(add);
    return out;
  }

  ladder.filter((id) => acceptedIds.has(id)).forEach(add);
  const primary = ladder[0];
  [...acceptedIds]
    .sort((a, b) => Math.abs(a - primary) - Math.abs(b - primary) || a - b)
    .forEach(add);
  return out;
}

export function conditionIdForEnum(en: string): number | null {
  return ENUM_TO_ID[en] ?? null;
}

export function conditionName(id: number, apparel: boolean): string {
  const n = CONDITION_NAMES[id];
  return n ? (apparel ? n.apparel : n.general) : `Condition ${id}`;
}

export function conditionStandard(id: number, apparel: boolean): string {
  const s = CONDITION_STANDARDS[id];
  return s ? (apparel ? s.apparel : s.general) : "";
}

/** Grade → apparel ID/label, for the UI before the category is known. */
export function gradeDisplay(value: string | undefined): { grade: ConditionGrade; id: number; label: string } {
  const grade = normalizeConditionGrade(value);
  const id = exactConditionId(value) ?? CONDITION_GRADES.find((g) => g.grade === grade)!.id;
  return { grade, id, label: conditionName(id, true) };
}

const ALL_NAMES = [...new Set(Object.values(CONDITION_NAMES).flatMap((n) => [n.apparel, n.general]))];
const ALL_STANDARDS = [...new Set(Object.values(CONDITION_STANDARDS).flatMap((n) => [n.apparel, n.general]))];

// Longest first, so "New with tags" wins over a bare "New".
const PREFIX_NAMES = [...ALL_NAMES].sort((a, b) => b.length - a.length);

/**
 * Remove a leading "<condition name>. <standard>" — added earlier by
 * buildConditionText() (a listing rebuilt from eBay carries it back in as its
 * notes), or written by the model itself ("New with tags; original hang
 * tag…") — so it isn't doubled on the way out.
 */
export function stripConditionPrefix(text: string): string {
  let out = text.trim();
  const lower = out.toLowerCase();
  const name = PREFIX_NAMES.find(
    (n) => lower.startsWith(n.toLowerCase()) && /^\s*[.;:,–—-]/.test(out.slice(n.length))
  );
  if (!name) return out;
  out = out.slice(name.length).replace(/^\s*[.;:,–—-]\s*/, "").trim();
  const standard = ALL_STANDARDS.find((st) => out.startsWith(st));
  if (standard) out = out.slice(standard.length).trim();
  return out.charAt(0).toUpperCase() + out.slice(1);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Seller-facing condition text for eBay's conditionDescription field:
 * "<eBay condition name>. <grading standard> <specific notes>". Dollar
 * amounts are stripped — eBay rejects pricing language in this field.
 */
export function buildConditionText(label: string, standard: string, notes: string | undefined): string {
  const cleanNotes = dropConflictingClaims(
    stripConditionPrefix(
      (notes || "").replace(/\$\d[\d,]*(\.\d{2})?/g, "").replace(/\s{2,}/g, " ").trim()
    ),
    isNewLabel(label)
  );
  return [`${label}.`, standard, cleanNotes].filter(Boolean).join(" ").slice(0, 1000);
}

// eBay's "New…" condition names (New, New with tags, New other (see
// details), New with defects…) vs. every pre-owned/used name.
function isNewLabel(label: string): boolean {
  return /^New\b/i.test(label.trim());
}

// Wording that claims the other side of the new/pre-owned line than the
// condition actually chosen — e.g. notes written for "Pre-owned - Excellent"
// left in place after the seller switches the item to "New without tags".
const USED_CLAIM =
  /\bpre-?owned\b|\bpreviously (?:owned|worn|used)\b|\b(?:gently|lightly) (?:worn|used)\b|\bworn (?:once|twice|a few times|\d)/i;
const NEW_CLAIM =
  /\bNWT\b|\bnew with(?:out)? tags\b|\bbrand[- ]new\b|\bnever (?:been )?worn\b|\bunworn\b|\btags (?:still )?attached\b/i;

/** Remove sentences whose condition claim contradicts the chosen grade. */
export function dropConflictingClaims(text: string, isNew: boolean): string {
  const conflict = isNew ? USED_CLAIM : NEW_CLAIM;
  return text
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => !conflict.test(sentence))
    .join(" ")
    .trim();
}

// The apparel condition names (plus NWT) as they appear in AI-written prose,
// tolerant of "Pre-owned Excellent" / "Pre-Owned – Excellent" spellings.
const CONDITION_MENTION =
  /\bNWT\b|\bNew with(?:out)? tags\b|\bNew with imperfections\b|\bPre-?owned\s*[-–—]?\s*(?:Excellent|Good|Fair)\b/gi;

/**
 * Rewrite every named condition in the description prose to the one actually
 * chosen, so the opening line can't say "Pre-owned Excellent" on an item
 * listed as "New without tags".
 */
function syncConditionMentions(html: string, label: string): string {
  return html.replace(CONDITION_MENTION, (m) => (m.toLowerCase() === label.toLowerCase() ? m : label));
}

// Longest first, so "New with tags" wins over a bare "New".
const NAMES_BY_LENGTH = [...new Set(Object.values(CONDITION_NAMES).flatMap((n) => [n.apparel, n.general]))].sort(
  (a, b) => b.length - a.length
);

// A description paragraph whose text starts with "Condition" (optionally
// wrapped in <strong>/<em>), e.g. <p><strong>Condition:</strong> ...</p>.
export const CONDITION_PARAGRAPH = /<p>\s*(?:<(?:strong|em|b)>\s*)?Condition\b[\s\S]*?<\/p>/i;

/**
 * Replace the description's condition paragraph with one built from the
 * chosen condition, so the HTML description always matches the grade. If the
 * description has no condition paragraph, one is inserted before the closing
 * italic sign-off (or appended).
 */
export function applyConditionToDescription(html: string, conditionText: string): string {
  const para = `<p><strong>Condition:</strong> ${escapeHtml(conditionText)}</p>`;
  const label = NAMES_BY_LENGTH.find((n) => conditionText.startsWith(`${n}.`));
  const src = label ? syncConditionMentions(html || "", label) : html || "";
  if (CONDITION_PARAGRAPH.test(src)) return src.replace(CONDITION_PARAGRAPH, para);
  const signOff = src.lastIndexOf("<p><em>");
  if (signOff >= 0) return `${src.slice(0, signOff)}${para}\n${src.slice(signOff)}`;
  return src ? `${src}\n${para}` : para;
}


/**
 * Mark's price endings: new items (NWT, NWOT, new in box, new with
 * imperfections) end in .95; pre-owned items end in .99. A whole-dollar
 * price drops to the ending just below it ($40 → $39.95); any other price
 * keeps its dollars ($44.95 pre-owned → $44.99).
 */
export function priceWithEnding(price: number, condition: string | undefined): number {
  if (!Number.isFinite(price) || price < 1) return price;
  const ending = normalizeConditionGrade(condition).startsWith("NEW") ? 0.95 : 0.99;
  const dollars = Math.floor(price + 1e-9);
  const cents = Math.round((price - dollars) * 100);
  const base = cents === 0 ? dollars - 1 : dollars;
  return Math.round((base + ending) * 100) / 100;
}
