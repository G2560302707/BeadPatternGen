import type { CompositionBackgroundType, CompositionParams } from "../../core/subject";
import { lockedPaletteColors } from "../palette-panel/locked-palette";

/** 构图纯色预设：从已锁定色卡取常用色，不另造色值。 */
export const BACKGROUND_PRESET_CODES = ["S01", "S05", "S08", "S11", "S13", "S14"] as const;

export const DEFAULT_SOLID_HEX = "#EAEEF3";

export function backgroundPresets(): Array<{ code: string; name: string; hex: string }> {
  const byCode = new Map(lockedPaletteColors().map((color) => [color.code, color]));
  return BACKGROUND_PRESET_CODES.flatMap((code) => {
    const color = byCode.get(code);
    return color ? [{ code: color.code, name: color.name, hex: color.hex.toUpperCase() }] : [];
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
