// lib/conditions.test.ts
//
// Condition grade → eBay condition ID resolution, and the buyer-facing
// condition text built from the ID actually submitted. The apparel ID set
// is the live policy for 57991 (Dress Shirts) and 11554 (Womens Jeans).

import { describe, it, expect } from "vitest";
import {
  applyConditionToDescription,
  buildConditionText,
  dropConflictingClaims,
  priceWithEnding,
  conditionIdCandidates,
  conditionName,
  conditionStandard,
  normalizeConditionGrade,
} from "./conditions";

const APPAREL = new Set([1000, 1500, 1750, 2990, 3000, 3010]);
const GENERAL = new Set([1000, 1500, 3000, 4000, 5000, 6000, 7000]);
const first = (grade: string, accepted: Set<number>, hint = false) =>
  conditionIdCandidates(grade, accepted, hint)[0];

describe("conditionIdCandidates — apparel categories (57991 / 11554)", () => {
  it("maps each grade to its own apparel ID", () => {
    expect(first("NEW_WITH_TAGS", APPAREL)).toBe(1000);
    expect(first("NEW_NO_TAGS", APPAREL)).toBe(1500);
    expect(first("NEW_WITH_DEFECTS", APPAREL)).toBe(1750);
    expect(first("EXCELLENT", APPAREL)).toBe(2990);
    expect(first("GOOD", APPAREL)).toBe(3000);
    expect(first("FAIR", APPAREL)).toBe(3010);
  });

  it("only ever returns IDs the category accepts", () => {
    for (const g of ["NEW_WITH_TAGS", "NEW_NO_TAGS", "NEW_WITH_DEFECTS", "EXCELLENT", "GOOD", "FAIR"]) {
      for (const id of conditionIdCandidates(g, APPAREL, true)) expect(APPAREL.has(id)).toBe(true);
    }
  });

  it("keeps legacy grades and eBay enums on the right tier", () => {
    expect(first("VERY_GOOD", APPAREL)).toBe(3000);
    // USED_EXCELLENT is eBay's enum for 3000 ("Pre-owned - Good"), not Excellent.
    expect(first("USED_EXCELLENT", APPAREL)).toBe(3000);
    expect(first("PRE_OWNED_EXCELLENT", APPAREL)).toBe(2990);
    expect(first("PRE_OWNED_FAIR", APPAREL)).toBe(3010);
  });

  it("steps down, not up, when the preferred tier is missing", () => {
    expect(first("EXCELLENT", new Set([1000, 3000, 3010]))).toBe(3000);
    expect(first("GOOD", new Set([1000, 2990, 3010]))).toBe(3010);
  });
});

describe("conditionIdCandidates — non-apparel / ungraded categories", () => {
  it("uses the classic scale in general categories", () => {
    expect(first("EXCELLENT", GENERAL)).toBe(3000);
    expect(first("GOOD", GENERAL)).toBe(5000);
    expect(first("FAIR", GENERAL)).toBe(6000);
    expect(first("NEW_WITH_TAGS", GENERAL)).toBe(1000);
  });

  it("falls back to the closest valid ID when grades aren't supported", () => {
    const newOrUsed = new Set([1000, 3000]);
    expect(first("EXCELLENT", newOrUsed)).toBe(3000);
    expect(first("FAIR", newOrUsed)).toBe(3000);
    // An item with defects isn't listed as pristine New when Used exists.
    expect(first("NEW_WITH_DEFECTS", newOrUsed)).toBe(3000);
    expect(first("NEW_NO_TAGS", newOrUsed)).toBe(1000);
    expect(conditionIdCandidates("GOOD", newOrUsed, false)).toEqual([3000, 1000]);
  });

  it("without a policy, uses the category hint and keeps both ladders for recovery", () => {
    const ids = conditionIdCandidates("EXCELLENT", new Set(), true);
    expect(ids[0]).toBe(2990);
    expect(ids).toContain(3000);
    expect(first("EXCELLENT", new Set(), false)).toBe(3000);
  });
});

describe("normalizeConditionGrade", () => {
  it("defaults unknown/empty values to GOOD", () => {
    expect(normalizeConditionGrade(undefined)).toBe("GOOD");
    expect(normalizeConditionGrade("mystery")).toBe("GOOD");
    expect(normalizeConditionGrade("Pre-owned - Excellent")).toBe("EXCELLENT");
    expect(normalizeConditionGrade("nwt")).toBe("NEW_WITH_TAGS");
  });
});

describe("condition text", () => {
  const text = (id: number, notes: string) =>
    buildConditionText(conditionName(id, true), conditionStandard(id, true), notes);

  it("leads with the eBay condition name and strips dollar amounts", () => {
    expect(text(3010, "Small stain on left cuff, $28.00 sticker.")).toBe(
      "Pre-owned - Fair. Noticeable wear or flaws, detailed below. Small stain on left cuff, sticker."
    );
  });

  it("is idempotent when notes already carry a built prefix (SKU rename round-trip)", () => {
    const once = text(2990, "No flaws.");
    expect(text(2990, once)).toBe(once);
    // …and a regrade replaces the old prefix rather than stacking it.
    expect(text(3000, once)).toBe(
      "Pre-owned - Good. Light, normal signs of wear. No significant flaws. No flaws."
    );
  });

  it("replaces the description's condition paragraph", () => {
    const html =
      "<h2>T</h2><p>Body</p><p>Condition: Worn 1-2× max. No flaws.</p><p><em>Find more</em></p>";
    const out = applyConditionToDescription(html, "Pre-owned - Good. Light wear.");
    expect(out).toBe(
      "<h2>T</h2><p>Body</p><p><strong>Condition:</strong> Pre-owned - Good. Light wear.</p><p><em>Find more</em></p>"
    );
    expect(applyConditionToDescription(out, "Pre-owned - Good. Light wear.")).toBe(out);
  });

  it("inserts a condition paragraph before the sign-off when missing", () => {
    const out = applyConditionToDescription("<p>Body</p><p><em>Find more</em></p>", "New with tags.");
    expect(out).toBe("<p>Body</p><p><strong>Condition:</strong> New with tags.</p>\n<p><em>Find more</em></p>");
  });
});


describe("condition wording follows the chosen grade", () => {
  it("drops pre-owned claims from notes on a New grade", () => {
    expect(
      buildConditionText(
        "New without tags",
        "New and unworn, without original tags. No flaws.",
        "Pre-owned with no visible wear. Snaps all work. A faint mark near the left shoulder seam."
      )
    ).toBe(
      "New without tags. New and unworn, without original tags. No flaws. Snaps all work. A faint mark near the left shoulder seam."
    );
  });

  it("doesn't repeat the condition name when the notes start with it", () => {
    expect(
      buildConditionText(
        "New with tags",
        "New with original tags attached. Never worn.",
        "New with tags; original hang tag attached at waistband. No stains."
      )
    ).toBe("New with tags. New with original tags attached. Never worn. Original hang tag attached at waistband. No stains.");
  });

  it("drops new-with-tags claims from notes on a pre-owned grade", () => {
    expect(dropConflictingClaims("NWT, never worn. Small pull on the left cuff.", false)).toBe(
      "Small pull on the left cuff."
    );
  });

  it("keeps notes that don't contradict the grade", () => {
    expect(dropConflictingClaims("Never worn. Tags attached.", true)).toBe("Never worn. Tags attached.");
  });

  it("rewrites other condition names in the description to the chosen one", () => {
    const html = "<p>Bonobos Mens Medium Bomber Jacket — Pre-owned Excellent, great layer.</p><p>Body</p>";
    const out = applyConditionToDescription(html, "New without tags. New and unworn.");
    expect(out).toContain("Bomber Jacket — New without tags, great layer.");
    expect(out).toContain("<p><strong>Condition:</strong> New without tags. New and unworn.</p>");
    expect(out).not.toContain("Pre-owned");
  });

  it("replaces NWT in prose when the item isn't new with tags", () => {
    const out = applyConditionToDescription("<p>Polo Shirt Large — NWT, $98 retail.</p>", "Pre-owned - Good. Light wear.");
    expect(out).toContain("Polo Shirt Large — Pre-owned - Good, $98 retail.");
  });
});

describe("price endings", () => {
  it("ends new items in .95", () => {
    expect(priceWithEnding(54.99, "NEW_WITH_TAGS")).toBe(54.95);
    expect(priceWithEnding(40, "NEW_NO_TAGS")).toBe(39.95);
    expect(priceWithEnding(44.95, "NEW_WITH_DEFECTS")).toBe(44.95);
  });
  it("ends pre-owned items in .99", () => {
    expect(priceWithEnding(44.95, "EXCELLENT")).toBe(44.99);
    expect(priceWithEnding(40, "GOOD")).toBe(39.99);
    expect(priceWithEnding(29.5, "FAIR")).toBe(29.99);
  });
});
