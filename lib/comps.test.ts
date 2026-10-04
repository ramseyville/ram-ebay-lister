// lib/comps.test.ts

import { describe, it, expect } from "vitest";
import { compConditionIds, compLevels, soldSearchUrl, terapeakUrl } from "@/lib/comps";

const listing = {
  title: "Polo Ralph Lauren Classic Fit Oxford Shirt Mens Blue L",
  description: "",
  brand: "Polo Ralph Lauren",
  item_type: "Button Down Shirt",
  color: "Light Blue",
  size: "L",
  condition: "EXCELLENT",
  item_specifics: { "Product Line": "Classic Fit" },
};

describe("comp search ladder", () => {
  it("widens in order: size, then color, then condition", () => {
    const levels = compLevels(listing);
    expect(levels.map((l) => l.key)).toEqual(["exact", "no_size", "no_color", "any_condition"]);
    expect(levels[0].keywords).toBe("Polo Ralph Lauren Classic Fit Button Down Shirt Blue");
    expect(levels[0].size).toBe("L");
    expect(levels[1].size).toBe("");
    expect(levels[1].keywords).toContain("Blue");
    expect(levels[2].keywords).not.toContain("Blue");
    expect(levels[2].conditionIds.length).toBeTruthy();
    expect(levels[3].conditionIds).toEqual([]);
  });

  it("groups conditions", () => {
    expect(compConditionIds("NEW_WITH_TAGS")).toEqual([1000]);
    expect(compConditionIds("NEW_NO_TAGS")).toEqual([1500]);
    expect(compConditionIds("GOOD")).toContain(3000);
  });

  it("builds sold and Terapeak links", () => {
    const exact = compLevels(listing)[0];
    expect(soldSearchUrl(exact)).toContain("LH_Sold=1");
    expect(soldSearchUrl(exact)).toContain("LH_Complete=1");
    expect(terapeakUrl(exact)).toContain("tabName=SOLD");
  });
});
