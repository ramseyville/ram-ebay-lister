// lib/title.test.ts

import { describe, it, expect } from "vitest";
import { cleanTitle, dropLowRetailPrice, hasPlainColor, plainColorFrom, titleLengthOk } from "@/lib/title";

describe("cleanTitle", () => {
  it("writes the retail price as a bare $ amount", () => {
    expect(cleanTitle("Tommy Bahama Silk Camp Shirt Mens XL $128 retail")).toBe(
      "Tommy Bahama Silk Camp Shirt Mens XL $128"
    );
    expect(cleanTitle("Hugo Boss Jetsetter Suit Mens 40R $1,295 NWT")).toBe(
      "Hugo Boss Jetsetter Suit Mens 40R $1295 NWT"
    );
    expect(cleanTitle("Peter Millar Polo Shirt Mens L MSRP 98")).toBe("Peter Millar Polo Shirt Mens L $98");
    expect(cleanTitle("Peter Millar Polo Shirt Mens L MSRP $98.00")).toBe("Peter Millar Polo Shirt Mens L $98");
    expect(cleanTitle("Faherty Shorts Mens 34 145 retail")).toBe("Faherty Shorts Mens 34 $145");
    expect(cleanTitle("Rhone Shorts Mens L $88 NWT")).toBe("Rhone Shorts Mens L $88 NWT");
  });

  it("removes punctuation and symbols", () => {
    expect(cleanTitle("Levi's 501 Jeans Men's 32x34 100% Cotton Blue/Black")).toBe(
      "Levis 501 Jeans Mens 32x34 Cotton Blue Black"
    );
    expect(cleanTitle("Peter Millar 1/4 Zip Pullover - Navy Blue & White")).toBe(
      "Peter Millar Quarter Zip Pullover Navy Blue and White"
    );
  });

  it("checks the 77-80 character rule", () => {
    expect(titleLengthOk("x".repeat(76))).toBe(false);
    expect(titleLengthOk("x".repeat(77))).toBe(true);
    expect(titleLengthOk("x".repeat(80))).toBe(true);
    expect(titleLengthOk("x".repeat(81))).toBe(false);
  });
});

describe("retail price over $85 only", () => {
  it("drops a retail price of $85 or less", () => {
    expect(dropLowRetailPrice("Rhone Shorts Mens L $85 NWT")).toBe("Rhone Shorts Mens L NWT");
    expect(dropLowRetailPrice("Rhone Shorts Mens L $45 NWT")).toBe("Rhone Shorts Mens L NWT");
  });
  it("keeps a retail price over $85", () => {
    expect(dropLowRetailPrice("Rhone Shorts Mens L $88 NWT")).toBe("Rhone Shorts Mens L $88 NWT");
    expect(dropLowRetailPrice("Hugo Boss Suit 40R $1295")).toBe("Hugo Boss Suit 40R $1295");
  });
});

describe("plain color word", () => {
  it("finds plain colors and ignores brand color names", () => {
    expect(hasPlainColor("Southern Tide Shorts Mens W38 Dark Seas NWT")).toBe(false);
    expect(hasPlainColor("Faherty Shorts Mens XL Blue Nights NWT")).toBe(true);
    expect(hasPlainColor("Peter Millar Polo Navy Blue L")).toBe(true);
  });
  it("pulls a plain color from the listing color field", () => {
    expect(plainColorFrom("Dark Seas Navy")).toBe("Navy");
    expect(plainColorFrom(["Heather", "Gray"])).toBe("Gray");
    expect(plainColorFrom("Dark Seas")).toBe(null);
  });
});
