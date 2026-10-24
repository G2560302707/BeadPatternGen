import { describe, expect, it } from "vitest";
import { clampRegionBox } from "./resegment";

describe("clampRegionBox", () => {
  it("normalizes drag direction and clamps to the image", () => {
    expect(clampRegionBox(30, 40, 10, 20, 50, 50)).toEqual({
      x: 10,
      y: 20,
      width: 20,
      height: 20,
    });
    expect(clampRegionBox(-10, -10, 40, 90, 50, 50)).toEqual({
      x: 0,
      y: 0,
      width: 40,
      height: 50,
    });
  });

  it("rejects regions smaller than 8px", () => {
    expect(clampRegionBox(0, 0, 7, 20, 50, 50)).toBeNull();
    expect(clampRegionBox(0, 0, 20, 7, 50, 50)).toBeNull();
  });
});
