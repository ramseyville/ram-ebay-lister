import { describe, expect, it } from "vitest";
import { cleanNumericAspects, numericAspectValue } from "./aspect-number";

describe("numericAspectValue", () => {
  it("keeps real numbers, with or without a weight unit", () => {
    expect(numericAspectValue("8")).toBe("8");
    expect(numericAspectValue("7.25 oz")).toBe("7.3");
    expect(numericAspectValue("180 gsm")).toBe("180");
    expect(numericAspectValue("6,5")).toBe("6.5");
  });

  it("drops text that only looks related", () => {
    expect(numericAspectValue("12-gauge")).toBeNull();
    expect(numericAspectValue("Midweight")).toBeNull();
    expect(numericAspectValue("0")).toBeNull();
    expect(numericAspectValue("")).toBeNull();
  });
});

describe("cleanNumericAspects", () => {
  it("removes a non-number Fabric Weight even without eBay's data type", () => {
    const aspects = { "Fabric Weight": ["12-gauge"], Brand: ["Peter Millar"] };
    cleanNumericAspects(aspects, []);
    expect(aspects).toEqual({ Brand: ["Peter Millar"] });
  });

  it("cleans any aspect eBay marks as a number", () => {
    const aspects: Record<string, string[]> = { "Chest Size": ["44 in"], Weight: ["2.5 lbs"] };
    cleanNumericAspects(aspects, [
      { name: "Weight", required: false, mode: "FREE_TEXT", values: [], dataType: "NUMBER" },
    ]);
    expect(aspects).toEqual({ "Chest Size": ["44 in"], Weight: ["2.5"] });
  });
});
