// lib/title.test.ts

import { describe, it, expect } from "vitest";
import { cleanTitle, titleLengthOk } from "@/lib/title";

describe("cleanTitle", () => {
  it("writes retail prices as MSRP with no $ sign", () => {
    expect(cleanTitle("Tommy Bahama Silk Camp Shirt Mens XL $128 retail")).toBe(
      "Tommy Bahama Silk Camp Shirt Mens XL MSRP 128"
    );
    expect(cleanTitle("Hugo Boss Jetsetter Suit Mens 40R $1,295 NWT")).toBe(
      "Hugo Boss Jetsetter Suit Mens 40R MSRP 1295 NWT"
    );
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
