import { describe, expect, it } from "vitest";
import { isLetterSize, looksLikeCasualButtonShirt } from "./shirt-category";

describe("isLetterSize", () => {
  it("recognises letter sizes and not neck/sleeve sizing", () => {
    for (const s of ["M", "L", "XL", "2XL", "XXL", "Large", "X-Large", "s"]) expect(isLetterSize(s)).toBe(true);
    for (const s of ["16", "16.5", "15 1/2", "17 34/35", "", undefined]) expect(isLetterSize(s as any)).toBe(false);
  });
});

describe("looksLikeCasualButtonShirt", () => {
  it("treats a letter-sized Oxford / button-down as casual", () => {
    expect(
      looksLikeCasualButtonShirt({ title: "Brooks Brothers Mens Blue Oxford Button Down Shirt Large", size: "L" })
    ).toBe(true);
    expect(looksLikeCasualButtonShirt({ title: "J Crew Mens Gingham Shirt XL", size: "XL" })).toBe(true);
  });
  it("leaves neck-sized dress shirts alone", () => {
    expect(
      looksLikeCasualButtonShirt({ title: "Robert Talbott Mens White Dress Shirt 16.5 34 Button Down", size: "16.5" })
    ).toBe(false);
  });
  it("does not sweep in letter-sized non-button tops", () => {
    expect(looksLikeCasualButtonShirt({ title: "Mens Henley Shirt Large", item_type: "Henley Shirt", size: "L" })).toBe(false);
    expect(looksLikeCasualButtonShirt({ title: "Mens Thermal Shirt XL", size: "XL" })).toBe(false);
  });
  it("uses a Button closure on a shirt as a signal", () => {
    expect(looksLikeCasualButtonShirt({ title: "Patagonia Mens Linen Shirt Medium", size: "M", closure: "Button" })).toBe(true);
  });
});
