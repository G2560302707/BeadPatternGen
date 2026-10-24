import { describe, expect, it } from "vitest";
import { lockedPaletteColors } from "../palette-panel/locked-palette";
import {
  BACKGROUND_PRESET_CODES,
  backgroundPatch,
  backgroundPresets,
  DEFAULT_SOLID_HEX,
  normalizeHex,
} from "./background-presets";

describe("background presets", () => {
  it("takes hex values from the locked palette only", () => {
    const palette = new Map(
      lockedPaletteColors().map((color) => [color.code, color.hex.toUpperCase()]),
    );
    for (const preset of backgroundPresets()) {
      expect(BACKGROUND_PRESET_CODES).toContain(preset.code);
      expect(preset.hex).toBe(palette.get(preset.code));
    }
    expect(backgroundPresets()).toHaveLength(BACKGROUND_PRESET_CODES.length);
  });

  it("pairs background type and value without touching scale or offset", () => {
    expect(backgroundPatch("transparent", "#FFFFFF")).toEqual({
      backgroundType: "transparent",
      backgroundValue: null,
    });
    expect(backgroundPatch("solid", "cb3531")).toEqual({
      backgroundType: "solid",
      backgroundValue: "#CB3531",
    });
    expect(backgroundPatch("solid", "nope").backgroundValue).toBe(DEFAULT_SOLID_HEX);
  });

  it("accepts #RRGGBB", () => {
    expect(normalizeHex("#eaeef3")).toBe("#EAEEF3");
    expect(normalizeHex("not-a-color")).toBeNull();
  });
});
