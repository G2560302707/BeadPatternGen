/**
 * S05 · 色卡索引与最近邻匹配 —— 公共出口。
 *
 * 目录之外只应通过 "./core/palette"（或 "@/core/palette"）导入。
 * index-builder.ts 中的 SpacePoint / PaletteSpace / indexPalette 属于
 * subset.ts 的内部协作接口，刻意不从本文件导出，避免上层绕过 PaletteIndex。
 */

export type { BeadColor, PaletteErrorCode, PaletteIndex, PaletteMatch } from "./types";
export { PaletteError } from "./types";

export { buildPaletteIndex } from "./index-builder";
export { selectPaletteSubset } from "./subset";
