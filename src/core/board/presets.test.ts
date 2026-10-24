import { describe, expect, it } from "vitest";
import {
  BOARD_SPECS,
  boardCount,
  boardCountLabel,
  finishedSizeCm,
  finishedSizeLabel,
} from "./presets";

describe("board presets", () => {
  it("matches market board sizes: 5mm units of 29, 2.6mm units of 26", () => {
    expect(BOARD_SPECS["5mm"].unitGrid).toBe(29);
    expect(BOARD_SPECS["5mm"].pitchMm).toBe(5);
    expect(BOARD_SPECS["5mm"].presets.map((preset) => preset.label)).toEqual([
      "29×29",
      "58×58",
      "87×87",
    ]);
    expect(BOARD_SPECS["2.6mm"].unitGrid).toBe(26);
    expect(BOARD_SPECS["2.6mm"].presets.map((preset) => preset.label)).toEqual([
      "26×26",
      "52×52",
      "78×78",
      "104×104",
    ]);
  });

  it("computes board counts with ceiling on partial boards", () => {
    expect(boardCount("5mm", 29, 29)).toBe(1);
    expect(boardCount("5mm", 58, 58)).toBe(4);
    expect(boardCount("5mm", 30, 29)).toBe(2);
    expect(boardCount("2.6mm", 52, 52)).toBe(4);
    expect(boardCount("2.6mm", 78, 78)).toBe(9);
    expect(boardCount("2.6mm", 27, 78)).toBe(6);
  });

  it("labels board layouts", () => {
    expect(boardCountLabel("5mm", 29, 29)).toBe("1 块板");
    expect(boardCountLabel("2.6mm", 78, 78)).toBe("3×3 拼接 9 块板");
  });

  it("converts finished size from pitch", () => {
    // 5mm × 29 = 14.5cm，与市售“钉区约 14.5cm 见方”一致。
    expect(finishedSizeCm("5mm", 29, 29)).toEqual({ widthCm: 14.5, heightCm: 14.5 });
    // 2.6mm 豆钉距 2.8mm × 52 = 14.56 → 14.6cm。
    expect(finishedSizeCm("2.6mm", 52, 52)).toEqual({ widthCm: 14.6, heightCm: 14.6 });
    expect(finishedSizeLabel("2.6mm", 26, 26)).toBe("成品约 7.3×7.3 cm");
    expect(finishedSizeLabel("5mm", 58, 29)).toBe("成品约 29×14.5 cm");
  });
});
