import { describe, expect, it } from "vitest";
import { PALETTE_KEYS, lockedPaletteColors } from "../palette-panel/locked-palette";
import {
  BACKGROUND_PRESET_CODES,
  backgroundPatch,
  backgroundPresets,
  DEFAULT_SOLID_HEX,
  normalizeHex,
} from "./background-presets";

describe("background presets", () => {
  it("takes hex values from the active palette only, for every built-in palette", () => {
    for (const key of PALETTE_KEYS) {
      const palette = new Map(
        lockedPaletteColors(key).map((color) => [color.code, color.hex.toUpperCase()]),
      );
      const presets = backgroundPresets(key);
      expect(presets).toHaveLength(BACKGROUND_PRESET_CODES.length);
      for (const preset of presets) {
        expect(preset.hex).toBe(palette.get(preset.code));
      }
    }
  });

  it("keeps the artkal-s presets identical to the reference codes", () => {
    const byCode = new Map(backgroundPresets("artkal-s").map((preset) => [preset.code, preset]));
    for (const code of BACKGROUND_PRESET_CODES) {
      expect(byCode.has(code)).toBe(true);
    }
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
