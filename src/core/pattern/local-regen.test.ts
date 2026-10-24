import { describe, expect, it } from "vitest";
import { EMPTY_CELL } from "./limits";
import { regenSelection } from "./local-regen";

describe("local regen", () => {
  const palette = [
    { code: "R", name: "R", hex: "#FF0000", manufacturer: "x" },
    { code: "G", name: "G", hex: "#00FF00", manufacturer: "x" },
  ];

  it("skips locked cells and empty samples", () => {
    const cells = new Int16Array([0, 0, 0, 0]);
    const locked = new Uint8Array([1, 0, 0, 0]);
    const rgb = new Uint8ClampedArray([0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0]);
    const alpha = new Uint8Array([255, 0, 255, 255]);
    const changes = regenSelection({
      cells,
      locked,
      indices: [0, 1, 2],
      width: 2,
      height: 2,
      rgb,
      alpha,
      palette,
      metric: "ciede2000",
      transparentPolicy: "empty",
    });
    expect(changes.some((change) => change.index === 0)).toBe(false);
    expect(changes).toContainEqual({ index: 1, from: 0, to: EMPTY_CELL });
    expect(changes.some((change) => change.index === 2 && change.to === 1)).toBe(true);
  });
});
