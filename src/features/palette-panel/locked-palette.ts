import artkalPalette from "../../core/palette/fixtures/artkal-s@beadcolors-f97ff428.json";
import mardPalette from "../../core/palette/fixtures/mard-221@pindou-color-data.json";
import type { BeadColor, PaletteDefinition } from "../../core/pattern";

// fixture JSON 的 colors 不含 manufacturer（由 paletteColors 从 definition 品牌补全），
// 结构上与 PaletteDefinition 不完全兼容，需经 unknown 断言。
const artkalDefinition = artkalPalette as unknown as PaletteDefinition;
const mardDefinition = mardPalette as unknown as PaletteDefinition;

export type PaletteKey = "mard-221" | "artkal-s";
export type BeadSize = "2.6mm" | "5mm";

export interface PaletteEntry {
  key: PaletteKey;
  /** 选项里展示的市面名称。 */
  label: string;
  /** 图纸页眉上的短名，如 "MARD 221"。 */
  chartLabel: string;
  /** 该色卡对应的豆子规格（同时决定板子预设与成品尺寸换算）。 */
  beadSize: BeadSize;
  definition: PaletteDefinition;
}

/** 内置色卡注册表。默认 MARD 221：国内 2.6mm 拼豆的事实标准色号体系。 */
export const PALETTES: Record<PaletteKey, PaletteEntry> = {
  "mard-221": {
    key: "mard-221",
    label: "MARD 221（2.6mm 小豆）",
    chartLabel: "MARD 221",
    beadSize: "2.6mm",
    definition: mardDefinition,
  },
  "artkal-s": {
    key: "artkal-s",
    label: "Artkal S（5mm 大豆）",
    chartLabel: "Artkal S",
    beadSize: "5mm",
    definition: artkalDefinition,
  },
};

export const DEFAULT_PALETTE_KEY: PaletteKey = "mard-221";

export const PALETTE_KEYS = Object.keys(PALETTES) as PaletteKey[];

export function isPaletteKey(value: unknown): value is PaletteKey {
  return typeof value === "string" && value in PALETTES;
}

/** 取色卡条目；未知值回退默认色卡，保证旧工程/脏状态可用。 */
export function paletteEntry(key?: string | null): PaletteEntry {
  return isPaletteKey(key) ? PALETTES[key] : PALETTES[DEFAULT_PALETTE_KEY];
}

export function paletteDefinition(key?: string | null): PaletteDefinition {
  return paletteEntry(key).definition;
}

export function paletteColors(key?: string | null): BeadColor[] {
  const definition = paletteEntry(key).definition;
  return definition.colors.map((color) => ({
    code: color.code,
    name: color.name,
    hex: color.hex,
    manufacturer: definition.brand,
    series: definition.series,
  }));
}

/** 按色卡 key 取整卡 BeadColor[]；缺省为默认色卡。 */
export function lockedPaletteColors(key?: string | null): BeadColor[] {
  return paletteColors(key);
}

/** 按色卡定义 id（即 pattern.paletteId，如 "mard-221-mini-2.6mm"）反查注册表条目。 */
export function paletteEntryByDefinitionId(definitionId?: string | null): PaletteEntry {
  const entry = PALETTE_KEYS.map((key) => PALETTES[key]).find(
    (candidate) => candidate.definition.paletteId === definitionId,
  );
  return entry ?? PALETTES[DEFAULT_PALETTE_KEY];
}

export function paletteColorsByDefinitionId(definitionId?: string | null): BeadColor[] {
  const entry = paletteEntryByDefinitionId(definitionId);
  return entry.definition.colors.map((color) => ({
    code: color.code,
    name: color.name,
    hex: color.hex,
    manufacturer: entry.definition.brand,
    series: entry.definition.series,
  }));
}
