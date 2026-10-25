/**
 * 统一「宣传卡片」视觉令牌：分享图 PNG、图纸 PNG、制作/预览 PDF 全部共用
 * 同一套颜色、分区线与文案结构，保证任何导出形式观感一致。
 * 令牌取值以分享图纸卡片（S23）为基准，改动这里等于同时改所有导出。
 */

import { hexToRgb } from "../core/color";
import type { BeadPattern, PatternStats } from "../core/pattern";
import { paletteEntryByDefinitionId } from "../features/palette-panel/locked-palette";

/** 卡片背景竖向渐变（暖粉）。 */
export const CARD_BG_GRADIENT = { top: "#FFF6F2", bottom: "#FBE7E3" };
/** 白色圆角卡片面。 */
export const CARD_FACE = "#FFFFFF";
/** 卡片投影的近似色（像素/PDF 无真投影时的暖灰替身）。 */
export const CARD_SHADOW = "#EBD9D3";

export const INK = "#3A3230";
export const INK_SOFT = "#8A7F7A";
export const INK_FADED = "#B3A69F";
export const ACCENT = "#E64340";
export const EMPTY_CELL_FILL = "#FAF9F6";

/** 细网格线 / 分区粗线：暖墨不同透明度（Canvas 用 rgba 字符串）。 */
export const GRID_LINE = "rgba(60, 50, 40, 0.10)";
export const GRID_MAJOR = "rgba(60, 50, 40, 0.32)";
/** 分区粗线间隔（格）：与市面图纸、分享卡片一致，每 5 格一条。 */
export const CARD_MAJOR_EVERY = 5;

/** 头部红描边标签文案（中文 / 纯 ASCII 位图字体两套）。 */
export const CARD_TAG_ZH = "拼豆图纸分享";
export const CARD_TAG_EN = "BEAD CHART";

/** 脚注文案。 */
export const CARD_FOOTER_ZH = "* 色号与用量仅供参考";
export const CARD_FOOTER_EN = "* CODES AND COUNTS FOR REFERENCE";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function hexRgb(hex: string): Rgb {
  return hexToRgb(hex);
}

/** 半透明暖墨混合到白底后的不透明近似色，供纯像素渲染与 PDF 使用。 */
export function mixOnWhite(hex: string, alpha: number): Rgb {
  const { r, g, b } = hexToRgb(hex);
  return {
    r: Math.round(255 - (255 - r) * alpha),
    g: Math.round(255 - (255 - g) * alpha),
    b: Math.round(255 - (255 - b) * alpha),
  };
}

export const GRID_LINE_SOLID = mixOnWhite("#3C3228", 0.1);
export const GRID_MAJOR_SOLID = mixOnWhite("#3C3228", 0.32);

/** 依据亮度选格内色号墨色（亮底深字、暗底浅字）。 */
export function inkCssOnCard(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  const y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return y > 0.55 ? "rgba(40, 32, 24, 0.85)" : "rgba(255, 255, 255, 0.92)";
}

export function inkRgbOnCard(hex: string): Rgb {
  const { r, g, b } = hexToRgb(hex);
  const y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return y > 0.55 ? { r: 40, g: 32, b: 24 } : { r: 255, g: 255, b: 255 };
}

export interface CardHeaderItem {
  label: string;
  value: string;
}

function chartLabelOf(pattern: BeadPattern): string {
  return paletteEntryByDefinitionId(pattern.paletteId).chartLabel;
}

/** 页眉信息项（中文版）：规格 / 色板 / 色数 / 用豆。 */
export function cardHeaderItems(pattern: BeadPattern, stats: PatternStats): CardHeaderItem[] {
  return [
    { label: "规格", value: `${pattern.width}×${pattern.height}` },
    { label: "色板", value: chartLabelOf(pattern) },
    { label: "色数", value: `${stats.colorCount} 色` },
    { label: "用豆", value: `${stats.beadCount.toLocaleString("en-US")} 颗` },
  ];
}

/** 页眉信息项（ASCII 版）：图纸 PNG 用 5×7 位图字体，仅能画 ASCII。 */
export function asciiCardHeaderItems(pattern: BeadPattern, stats: PatternStats): CardHeaderItem[] {
  const ascii = (text: string) =>
    [...text]
      .map((ch) => (/^[A-Za-z0-9 ._\-x/()]/.test(ch) ? ch : ""))
      .join("")
      .trim();
  return [
    { label: "SIZE", value: `${pattern.width}x${pattern.height}` },
    { label: "PALETTE", value: ascii(chartLabelOf(pattern)) || "PAL" },
    { label: "COLORS", value: String(stats.colorCount) },
    { label: "BEADS", value: stats.beadCount.toLocaleString("en-US") },
  ];
}

/**
 * PDF 中文字体子集的字符集（与 scripts/pdf-font-charset.mjs 必须保持一致，
 * 有单测对拍）。PDF 内所有中文文案都只能用这里的字符。
 */
export const PDF_CJK_CHARSET =
  "拼豆图纸分享制作版预览规格色板数用豆颗第页共行列重叠右下色卡清单按排序号与参考仅供每格分区线核对水印整图缩放矢量不失真单纸张裁切间加号左右上下备用";
