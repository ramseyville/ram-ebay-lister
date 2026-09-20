// lib/ebay/size-logic.test.ts
//
// Every case in this file traces back to a real, confirmed failure from one
// long debugging session — a specific listing that got rejected by eBay,
// diagnosed, and fixed. These aren't hypothetical edge cases; they're the
// actual regression suite for bugs that already happened once. The goal is
// that none of them can happen again silently: a future change that breaks
// any of this fails a test immediately, instead of failing a real listing
// days or weeks later.

import { describe, it, expect } from "vitest";
import {
  cleanSizeBase,
  sizeParts,
  isExtendedSize,
  sizeTypeCandidates,
  inferSizeType,
  normalizeExtendedSize,
  sizeCandidates,
  looksLikeSizeCode,
  sizeAspectValue,
  isFragranceItem,
} from "./size-logic";

describe("cleanSizeBase", () => {
  it("leaves O/S untouched (not bilingual notation)", () => {
    expect(cleanSizeBase("O/S")).toBe("O/S");
  });
  it("strips bilingual dual-notation second half", () => {
    expect(cleanSizeBase("3XLB/3TGG")).toBe("3XLB");
    expect(cleanSizeBase("XLT/TGL")).toBe("XLT");
  });
  it("strips trailing parenthetical explanations", () => {
    expect(cleanSizeBase("XLT (XL Tall)")).toBe("XLT");
  });
  it("leaves plain sizes unchanged", () => {
    expect(cleanSizeBase("L")).toBe("L");
    expect(cleanSizeBase("32")).toBe("32");
  });
});

describe("sizeParts", () => {
  it("splits on bilingual slash into separate checkable parts", () => {
    expect(sizeParts("3XLB/3TGG")).toEqual(["3XLB", "3TGG"]);
  });
  it("includes the parenthetical as its own part (it can be the only signal)", () => {
    expect(sizeParts("18 1/2 - 36/37 (Big Man)")).toContain("Big Man");
  });
  it("handles plain sizes with no slash or parenthetical", () => {
    expect(sizeParts("XLT")).toEqual(["XLT"]);
  });
});

describe("isExtendedSize", () => {
  it("detects standard extended-size patterns", () => {
    expect(isExtendedSize("XLT")).toBe(true);
    expect(isExtendedSize("2XLT")).toBe(true);
    expect(isExtendedSize("3XL")).toBe(true);
    expect(isExtendedSize("5X")).toBe(true);
  });
  it("detects Tall/Big as trailing words, not just compact codes", () => {
    expect(isExtendedSize("19 36/37 Tall")).toBe(true);
    expect(isExtendedSize("18 1/2 - 36/37 (Big Man)")).toBe(true);
  });
  it("detects signals on either side of a bilingual slash", () => {
    expect(isExtendedSize("XLT/TGL")).toBe(true);
    expect(isExtendedSize("3XLB/3TGG")).toBe(true);
  });
  it("does not flag standard sizes", () => {
    expect(isExtendedSize("L")).toBe(false);
    expect(isExtendedSize("M")).toBe(false);
    expect(isExtendedSize("XL")).toBe(false);
    expect(isExtendedSize("")).toBe(false);
  });
  it("does not misfire on O/S (One Size)", () => {
    expect(isExtendedSize("O/S")).toBe(false);
  });
});

describe("sizeTypeCandidates", () => {
  it("prioritizes Tall first for Tall-pattern codes, Big & Tall as fallback", () => {
    expect(sizeTypeCandidates("XLT", "mens_top")).toEqual(["Tall", "Big & Tall"]);
    expect(sizeTypeCandidates("2XLT", "mens_sweater")).toEqual(["Tall", "Big & Tall"]);
  });
  it("prioritizes Big & Tall first for Big-pattern codes, Tall as fallback", () => {
    expect(sizeTypeCandidates("3XLB", "mens_top")).toEqual(["Big & Tall", "Tall"]);
    expect(sizeTypeCandidates("5X", "mens_sweater")).toEqual(["Big & Tall", "Tall"]);
  });
  it("detects Big/Tall as trailing words in dress-shirt-style sizes", () => {
    expect(sizeTypeCandidates("19 36/37 Tall", "mens_top")).toEqual(["Tall", "Big & Tall"]);
    expect(sizeTypeCandidates("18 1/2 - 36/37 (Big Man)", "mens_top")).toEqual([
      "Big & Tall",
      "Tall",
    ]);
  });
  it("detects signals through bilingual notation", () => {
    expect(sizeTypeCandidates("XLT/TGL", "mens_top")).toEqual(["Tall", "Big & Tall"]);
  });
  it("detects the NXT/NXB abbreviation family", () => {
    expect(sizeTypeCandidates("3XT", "mens_top")).toEqual(["Tall", "Big & Tall"]);
    expect(sizeTypeCandidates("4XB", "mens_top")).toEqual(["Big & Tall", "Tall"]);
  });
  it("returns Regular for standard sizes", () => {
    expect(sizeTypeCandidates("L", "mens_top")).toEqual(["Regular"]);
    expect(sizeTypeCandidates("32", "mens_pants")).toEqual(["Regular"]);
  });
  it("handles women's Plus and Petite sizing separately from men's Big/Tall", () => {
    expect(sizeTypeCandidates("2X", "womens_top")).toEqual(["Plus"]);
    expect(sizeTypeCandidates("PS", "womens_top")).toEqual(["Petite"]);
    expect(sizeTypeCandidates("16W", "womens_top")).toEqual(["Plus"]);
  });
  it("detects Big & Tall for men's pants by waist size 44+", () => {
    expect(sizeTypeCandidates("46", "mens_pants")).toEqual(["Big & Tall", "Tall"]);
  });
});

describe("inferSizeType (single best guess)", () => {
  it("returns the first candidate from sizeTypeCandidates", () => {
    expect(inferSizeType("XLT", "mens_top")).toBe("Tall");
    expect(inferSizeType("3XLB", "mens_top")).toBe("Big & Tall");
    expect(inferSizeType("L", "mens_top")).toBe("Regular");
  });
});

describe("normalizeExtendedSize", () => {
  it("adds the L suffix to bare NX sizes", () => {
    expect(normalizeExtendedSize("5X")).toBe("5XL");
    expect(normalizeExtendedSize("2X")).toBe("2XL");
  });
  it("leaves already-correct or unrelated sizes unchanged", () => {
    expect(normalizeExtendedSize("5XL")).toBe("5XL");
    expect(normalizeExtendedSize("L")).toBe("L");
  });
});

describe("sizeCandidates", () => {
  it("generates NXL/Big NX/NX candidates for the NXLB family, raw code last", () => {
    expect(sizeCandidates("3XLB", "mens_top")).toEqual(["3XL", "Big 3X", "3X", "3XLB"]);
  });
  it("strips bilingual notation before generating candidates", () => {
    expect(sizeCandidates("3XLB/3TGG", "mens_top")).toEqual(["3XL", "Big 3X", "3X", "3XLB"]);
  });
  it("generates candidates for bare NX sizes", () => {
    expect(sizeCandidates("5X", "mens_top")).toEqual(["5XL", "Big 5X", "5X"]);
  });
  it("generates candidates for the NXT (Tall, no L) abbreviation", () => {
    expect(sizeCandidates("3XT", "mens_top")).toEqual(["3XLT", "3XT"]);
    expect(sizeCandidates("2XT", "mens_top")).toEqual(["2XLT", "2XT"]);
  });
  it("generates candidates for the NXB (Big, no L) abbreviation", () => {
    expect(sizeCandidates("4XB", "mens_top")).toEqual(["4XL", "Big 4X", "4X", "4XB"]);
  });
  it("leaves already-standard tall codes as a single unchanged candidate", () => {
    expect(sizeCandidates("2XLT", "mens_top")).toEqual(["2XLT"]);
    expect(sizeCandidates("XLT (XL Tall)", "mens_top")).toEqual(["XLT"]);
  });
  it("recognizes O/S as One Size, not bilingual notation", () => {
    expect(sizeCandidates("O/S", "mens_tie")).toEqual(["One Size", "OS", "O/S"]);
  });
  it("extracts the bare waist number from waist-by-inseam pants sizing, regardless of category", () => {
    expect(sizeCandidates("28x29", "mens_pants")).toEqual(["28"]);
    expect(sizeCandidates("29x31", "mens_pants")).toEqual(["29"]);
    // Confirmed bug: this must work even when the category classification
    // is wrong/generic — the pattern itself is what matters, not a gate
    // requiring an exact category match.
    expect(sizeCandidates("29x31", "other")).toEqual(["29"]);
    expect(sizeCandidates("29x31", "mens_clothing")).toEqual(["29"]);
  });
  it("leaves plain standard sizes as a single unchanged candidate", () => {
    expect(sizeCandidates("L", "mens_top")).toEqual(["L"]);
    expect(sizeCandidates("M", "mens_top")).toEqual(["M"]);
  });
});

describe("looksLikeSizeCode", () => {
  it("accepts anything with a digit", () => {
    expect(looksLikeSizeCode("18")).toBe(true);
    expect(looksLikeSizeCode("3XL")).toBe(true);
  });
  it("accepts standard letter-size codes", () => {
    expect(looksLikeSizeCode("L")).toBe(true);
    expect(looksLikeSizeCode("XL")).toBe(true);
    expect(looksLikeSizeCode("XXL")).toBe(true);
    expect(looksLikeSizeCode("M")).toBe(true);
    expect(looksLikeSizeCode("OS")).toBe(true);
  });
  it("rejects purely descriptive text with no digit or size-code shape", () => {
    // Confirmed real bug: the app once submitted "Big Man" as a literal
    // Size value, which eBay correctly rejected as unrecognized.
    expect(looksLikeSizeCode("BIGMAN")).toBe(false);
    expect(looksLikeSizeCode("")).toBe(false);
  });
});

describe("sizeAspectValue", () => {
  it("rejects fabricated/descriptive text, returning empty rather than submitting it", () => {
    expect(sizeAspectValue("Big Man", "mens_top")).toBe("");
  });
  it("returns the best real candidate for standard cases", () => {
    expect(sizeAspectValue("3XLB", "mens_top")).toBe("3XL");
    expect(sizeAspectValue("L", "mens_top")).toBe("L");
  });
  it("extracts the waist number for pants regardless of category classification", () => {
    expect(sizeAspectValue("29x31", "mens_pants")).toBe("29");
    expect(sizeAspectValue("29x31", "other")).toBe("29");
  });
});

describe("isFragranceItem", () => {
  it("detects cologne/perfume/aftershave keywords in the title", () => {
    expect(
      isFragranceItem({
        title: "Bvlgari Eau Parfumee Au The Rouge Cologne Body Lotion After Shave 3pc Gift Set",
      } as any)
    ).toBe(true);
    expect(isFragranceItem({ title: "Some Brand Perfume 50ml EDP" } as any)).toBe(true);
  });
  it("does not flag ordinary clothing titles", () => {
    expect(
      isFragranceItem({
        title: "Nike Sportswear Womens Brown Cropped Oversized Fleece Quarter Zip Pullover S NWT",
      } as any)
    ).toBe(false);
  });
});
