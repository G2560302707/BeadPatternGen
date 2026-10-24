import { deltaE2000, hexToRgb, rgbToLab } from "../../core/color";
import type { CompositionBackgroundType, CompositionParams } from "../../core/subject";
import type { BeadColor } from "../../core/pattern";
import { lockedPaletteColors } from "../palette-panel/locked-palette";

/**
 * 构图纯色预设：以 artkal-s 六个常用色为角色参照，
 * 在当前色卡里按 CIEDE2000 取最近色，不另造色值。
 */
export const BACKGROUND_PRESET_CODES = ["S01", "S05", "S08", "S11", "S13", "S14"] as const;

const PRESET_SOURCE_PALETTE = "artkal-s";

export const DEFAULT_SOLID_HEX = "#EAEEF3";

function roleColors(): BeadColor[] {
  const byCode = new Map(lockedPaletteColors(PRESET_SOURCE_PALETTE).map((c) => [c.code, c]));
  return BACKGROUND_PRESET_CODES.flatMap((code) => {
    const color = byCode.get(code);
    return color ? [color] : [];
  });
}

export function backgroundPresets(
  paletteKey?: string | null,
): Array<{ code: string; name: string; hex: string }> {
  const palette = lockedPaletteColors(paletteKey);
  const paletteLab = palette.map((color) => {
    const { r, g, b } = hexToRgb(color.hex);
    return rgbToLab({ r, g, b });
  });
  return roleColors().map((role) => {
    const { r, g, b } = hexToRgb(role.hex);
    const target = rgbToLab({ r, g, b });
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    paletteLab.forEach((lab, index) => {
      const distance = deltaE2000(lab, target);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    const color = palette[bestIndex];
    if (!color) {
      return { code: "-", name: "-", hex: DEFAULT_SOLID_HEX };
    }
    return { code: color.code, name: color.name, hex: color.hex.toUpperCase() };
  });
}

export function normalizeHex(value: string): string | null {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(value.trim());
  return match?.[1] ? `#${match[1].toUpperCase()}` : null;
}

export function backgroundPatch(
  type: CompositionBackgroundType,
  hex: string | null,
): Pick<CompositionParams, "backgroundType" | "backgroundValue"> {
  if (type === "transparent") {
    return { backgroundType: "transparent", backgroundValue: null };
  }
  if (type === "solid") {
    return {
      backgroundType: "solid",
      backgroundValue: normalizeHex(hex ?? "") ?? DEFAULT_SOLID_HEX,
    };
  }
  return { backgroundType: "image", backgroundValue: "pending-custom-bg" };
}
