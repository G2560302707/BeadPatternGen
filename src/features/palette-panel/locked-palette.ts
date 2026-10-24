import lockedPalette from "../../core/palette/fixtures/artkal-s@beadcolors-f97ff428.json";
import type { BeadColor } from "../../core/pattern";

export function lockedPaletteColors(): BeadColor[] {
  return lockedPalette.colors.map((color) => ({
    code: color.code,
    name: color.name,
    hex: color.hex,
    manufacturer: lockedPalette.brand,
    series: lockedPalette.series,
  }));
}

export { lockedPalette };
