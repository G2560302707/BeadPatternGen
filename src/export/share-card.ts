/**
 * 分享图纸 PNG（S23）：模仿市面社交平台拼豆图纸的竖版卡片导出。
 *
 * 结构自上而下：页眉信息栏（规格/色板/色数/用豆 + 红描边标签）、
 * 白色圆角图纸卡片（彩色格子 + 格内色号 + 每 5 格粗线 + 顶侧行列号）、
 * 色卡图例（圆角色块 + 色号 + 用量）、底部「原图 / 烫后效果模拟」对比区、
 * 脚注与水印。布局计算（shareCardLayout）为纯函数，渲染走 Canvas 2D。
 */

import { EMPTY_CELL } from "../core/pattern";
import type { BeadPattern, PatternStats } from "../core/pattern";
import { paletteEntryByDefinitionId } from "../features/palette-panel/locked-palette";
import {
  ACCENT,
  CARD_BG_GRADIENT,
  CARD_FOOTER_ZH,
  CARD_MAJOR_EVERY,
  CARD_TAG_ZH,
  EMPTY_CELL_FILL,
  GRID_LINE,
  GRID_MAJOR,
  INK,
  INK_FADED,
  INK_SOFT,
  inkCssOnCard,
} from "./card-style";
import { assertExportReady } from "./assert";
import { ExportError } from "./errors";

export interface ShareCardSource {
  image: CanvasImageSource;
  width: number;
  height: number;
  crop?: { x: number; y: number; width: number; height: number } | null;
}

export interface ShareCardOptions {
  /** 输出倍率：1 = 1242 宽，2 = 2484 宽（高清）。 */
  scale?: number;
  /** 底部「原图 / 烫后效果模拟」对比区开关；无原图时自动降级为只显示烫后模拟。 */
  showCompare?: boolean;
  /** 右下水印文字；空字符串则不画。 */
  watermark?: string;
  source?: ShareCardSource | null;
}

export interface ShareCardLayout {
  width: number;
  height: number;
  header: { x: number; y: number; w: number; h: number };
  /** 图纸卡片（含圆角卡片本体），网格内容相对卡片左上角。 */
  card: { x: number; y: number; w: number; h: number; pad: number; radius: number };
  grid: { x: number; y: number; cell: number; cols: number; rows: number };
  ruler: number;
  legend: { x: number; y: number; itemW: number; itemH: number; rows: number; perRow: number };
  compare: { y: number; panelW: number; panelH: number; gap: number; labelH: number } | null;
  footer: { y: number };
  showCodes: boolean;
}

const CARD_W = 1242;
const PAD = 36;
const HEADER_H = 92;
const SECTION_GAP = 26;
const CARD_PAD = 24;
const CARD_R = 22;
const RULER = 32;
const MIN_CELL = 3;
/** 格内色号的最小格尺寸；78×78 在 1242 宽下为 13px，仍可读。 */
const CODE_MIN_CELL = 13;
/** 图纸网格粗线间隔（格）：统一宣传卡片版式的每 5 格分区线。 */
const MAJOR_EVERY = CARD_MAJOR_EVERY;

const LEGEND_ITEM_W = 104;
const LEGEND_ITEM_H = 96;
const LEGEND_GAP_X = 14;
const COMPARE_PANEL_H = 272;
const COMPARE_LABEL_H = 46;
const COMPARE_GAP = 24;
const FOOTER_H = 54;


export function shareCardLayout(
  pattern: BeadPattern,
  usedColorCount: number,
  options: ShareCardOptions = {},
): ShareCardLayout {
  const innerW = CARD_W - PAD * 2;
  const showCompare = options.showCompare !== false;

  const cell = Math.max(
    MIN_CELL,
    Math.floor((innerW - CARD_PAD * 2 - RULER) / pattern.width),
  );
  const gridW = cell * pattern.width;
  const gridH = cell * pattern.height;
  const cardW = RULER + gridW + CARD_PAD * 2;
  const cardH = RULER + gridH + CARD_PAD * 2;
  const cardX = PAD + (innerW - cardW) / 2;

  const perRow = Math.max(1, Math.floor((innerW + LEGEND_GAP_X) / (LEGEND_ITEM_W + LEGEND_GAP_X)));
  const legendRows = Math.max(1, Math.ceil(usedColorCount / perRow));

  let y = PAD + HEADER_H + SECTION_GAP + cardH + SECTION_GAP;
  const legendY = y;
  y += legendRows * LEGEND_ITEM_H;

  let compare: ShareCardLayout["compare"] = null;
  if (showCompare) {
    compare = {
      y: y + SECTION_GAP,
      panelW: Math.floor((innerW - COMPARE_GAP) / 2),
      panelH: COMPARE_PANEL_H,
      gap: COMPARE_GAP,
      labelH: COMPARE_LABEL_H,
    };
    y = compare.y + COMPARE_PANEL_H + COMPARE_LABEL_H;
  }

  const footerY = y + SECTION_GAP;
  const height = footerY + FOOTER_H + PAD;

  return {
    width: CARD_W,
    height,
    header: { x: PAD, y: PAD, w: innerW, h: HEADER_H },
    card: { x: cardX, y: PAD + HEADER_H + SECTION_GAP, w: cardW, h: cardH, pad: CARD_PAD, radius: CARD_R },
    grid: { x: cardX + CARD_PAD + RULER, y: PAD + HEADER_H + SECTION_GAP + CARD_PAD + RULER, cell, cols: pattern.width, rows: pattern.height },
    ruler: RULER,
    legend: { x: PAD, y: legendY, itemW: LEGEND_ITEM_W, itemH: LEGEND_ITEM_H, rows: legendRows, perRow },
    compare,
    footer: { y: footerY },
    showCodes: cell >= CODE_MIN_CELL,
  };
}

function roundedPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

/** 相对亮度决定格内色号墨色：亮底深字、暗底浅字（所有导出统一规则）。 */
function inkOnHex(hex: string): string {
  return inkCssOnCard(hex);
}

/** 确定性伪随机（细闪颗粒位置用），不引入随机源保证可复现导出。 */
function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return (h ^ (h >>> 16)) >>> 0;
}

function font(size: number, weight = "400"): string {
  return `${weight} ${size}px "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif`;
}

function drawBackground(ctx: CanvasRenderingContext2D, layout: ShareCardLayout): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, layout.height);
  gradient.addColorStop(0, CARD_BG_GRADIENT.top);
  gradient.addColorStop(1, CARD_BG_GRADIENT.bottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, layout.width, layout.height);
}

function drawHeader(
  ctx: CanvasRenderingContext2D,
  layout: ShareCardLayout,
  pattern: BeadPattern,
  stats: PatternStats,
): void {
  const { x, y, w, h } = layout.header;
  ctx.save();
  ctx.fillStyle = "#FFFFFF";
  roundedPath(ctx, x, y, w, h, 20);
  ctx.fill();

  const chartLabel = paletteEntryByDefinitionId(pattern.paletteId).chartLabel;
  const items: Array<{ label: string; value: string }> = [
    { label: "规格", value: `${pattern.width}×${pattern.height}` },
    { label: "色板", value: chartLabel },
    { label: "色数", value: `${stats.colorCount} 色` },
    { label: "用豆", value: `${stats.beadCount.toLocaleString("en-US")} 颗` },
  ];

  // 右侧红描边标签（参照图纸右上角的「拼豆图纸分享」角标）；空间不足时省略。
  const tagText = CARD_TAG_ZH;
  ctx.font = font(24, "600");
  const tagTextW = ctx.measureText(tagText).width;
  const tagW = tagTextW + 36;
  const tagH = 46;
  const tagX = x + w - 28 - tagW;
  const tagY = y + (h - tagH) / 2;

  // 信息项：小灰标签 + 粗体值，纵向排列。
  ctx.textAlign = "left";
  let itemX = x + 40;
  for (const item of items) {
    ctx.font = font(21);
    ctx.fillStyle = INK_SOFT;
    ctx.fillText(item.label, itemX, y + 32);
    ctx.font = font(32, "700");
    ctx.fillStyle = INK;
    ctx.fillText(item.value, itemX, y + 66);
    itemX += Math.max(ctx.measureText(item.value).width, 64) + 58;
  }

  if (itemX <= tagX - 12) {
    roundedPath(ctx, tagX, tagY, tagW, tagH, tagH / 2);
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = ACCENT;
    ctx.stroke();
    ctx.fillStyle = ACCENT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = font(24, "600");
    ctx.fillText(tagText, tagX + tagW / 2, tagY + tagH / 2 + 1);
  }
  ctx.restore();
}

function drawCardFrame(ctx: CanvasRenderingContext2D, layout: ShareCardLayout): void {
  const { x, y, w, h, radius } = layout.card;
  ctx.save();
  ctx.shadowColor = "rgba(120, 70, 60, 0.16)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = "#FFFFFF";
  roundedPath(ctx, x, y, w, h, radius);
  ctx.fill();
  ctx.restore();

  // 红色 L 形角标：左上 + 右下（参照图纸样式）。
  const len = 40;
  const thick = 7;
  ctx.save();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = thick;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x + 18, y + 18 + len);
  ctx.lineTo(x + 18, y + 18);
  ctx.lineTo(x + 18 + len, y + 18);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + w - 18 - len, y + h - 18);
  ctx.lineTo(x + w - 18, y + h - 18);
  ctx.lineTo(x + w - 18, y + h - 18 - len);
  ctx.stroke();
  ctx.restore();
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  pattern: BeadPattern,
  layout: ShareCardLayout,
): void {
  const { grid, ruler } = layout;
  const { cell, cols, rows } = grid;
  ctx.save();
  ctx.beginPath();
  ctx.rect(grid.x - ruler, grid.y - ruler, cols * cell + ruler + 8, rows * cell + ruler + 8);
  ctx.clip();

  for (let gy = 0; gy < rows; gy += 1) {
    for (let gx = 0; gx < cols; gx += 1) {
      const paletteIndex = pattern.cells[gy * cols + gx] ?? EMPTY_CELL;
      const px = grid.x + gx * cell;
      const py = grid.y + gy * cell;
      if (paletteIndex === EMPTY_CELL) {
        ctx.fillStyle = EMPTY_CELL_FILL;
      } else {
        const color = pattern.palette[paletteIndex];
        if (color === undefined) {
          throw new ExportError("E_EXPORT", `share card cell (${gx},${gy}) palette missing`);
        }
        ctx.fillStyle = color.hex;
      }
      ctx.fillRect(px, py, cell + 1, cell + 1);
    }
  }

  // 细网格线 + 每 5 格粗线（参照图纸的分区线）。
  ctx.lineWidth = 1;
  ctx.strokeStyle = GRID_LINE;
  ctx.beginPath();
  for (let gx = 1; gx < cols; gx += 1) {
    if (gx % MAJOR_EVERY === 0) continue;
    const x = grid.x + gx * cell;
    ctx.moveTo(x, grid.y);
    ctx.lineTo(x, grid.y + rows * cell);
  }
  for (let gy = 1; gy < rows; gy += 1) {
    if (gy % MAJOR_EVERY === 0) continue;
    const y = grid.y + gy * cell;
    ctx.moveTo(grid.x, y);
    ctx.lineTo(grid.x + cols * cell, y);
  }
  ctx.stroke();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = GRID_MAJOR;
  ctx.beginPath();
  for (let gx = MAJOR_EVERY; gx < cols; gx += MAJOR_EVERY) {
    const x = grid.x + gx * cell;
    ctx.moveTo(x, grid.y);
    ctx.lineTo(x, grid.y + rows * cell);
  }
  for (let gy = MAJOR_EVERY; gy < rows; gy += MAJOR_EVERY) {
    const y = grid.y + gy * cell;
    ctx.moveTo(grid.x, y);
    ctx.lineTo(grid.x + cols * cell, y);
  }
  ctx.stroke();

  if (layout.showCodes) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const fontSize = Math.max(7, Math.floor(cell * 0.34));
    ctx.font = font(fontSize, "600");
    for (let gy = 0; gy < rows; gy += 1) {
      for (let gx = 0; gx < cols; gx += 1) {
        const paletteIndex = pattern.cells[gy * cols + gx] ?? EMPTY_CELL;
        if (paletteIndex === EMPTY_CELL) continue;
        const color = pattern.palette[paletteIndex];
        if (color === undefined) continue;
        ctx.fillStyle = inkOnHex(color.hex);
        ctx.fillText(
          color.code,
          grid.x + gx * cell + cell / 2 + 0.5,
          grid.y + gy * cell + cell / 2 + 0.5,
        );
      }
    }
  }
  ctx.restore();

  // 顶/左行列号：骑在每 5 格的分界线上（5/10/15…，与市面图纸一致）。
  ctx.save();
  ctx.font = font(Math.min(20, Math.max(14, ruler * 0.62)));
  ctx.fillStyle = INK_SOFT;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let line = MAJOR_EVERY; line < cols; line += MAJOR_EVERY) {
    ctx.fillText(String(line), grid.x + line * cell, grid.y - ruler / 2);
  }
  ctx.textAlign = "center";
  for (let line = MAJOR_EVERY; line < rows; line += MAJOR_EVERY) {
    ctx.fillText(String(line), grid.x - 12, grid.y + line * cell);
  }
  ctx.restore();
}

function drawLegend(
  ctx: CanvasRenderingContext2D,
  layout: ShareCardLayout,
  stats: PatternStats,
): void {
  const used = stats.byColor.filter((row) => row.count > 0);
  used.sort((a, b) => b.count - a.count);
  const { x, y, itemW, itemH, perRow } = layout.legend;
  const swatchW = itemW;
  const swatchH = 54;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  used.forEach((row, index) => {
    const col = index % perRow;
    const lineRow = Math.floor(index / perRow);
    const px = x + col * (itemW + LEGEND_GAP_X);
    const py = y + lineRow * itemH;
    ctx.fillStyle = row.hex;
    roundedPath(ctx, px, py, swatchW, swatchH, 12);
    ctx.fill();
    // 亮底深字、暗底白字，保证浅色块上的色号可读。
    ctx.font = font(23, "700");
    ctx.fillStyle = inkOnHex(row.hex);
    ctx.shadowColor = "rgba(0, 0, 0, 0.18)";
    ctx.shadowBlur = 2;
    ctx.shadowOffsetY = 1;
    ctx.fillText(row.code, px + swatchW / 2, py + swatchH / 2 + 1);
    ctx.shadowColor = "transparent";
    ctx.font = font(21);
    ctx.fillStyle = INK_FADED;
    ctx.fillText(String(row.count), px + swatchW / 2, py + swatchH + 18);
  });
  ctx.restore();
}

/** 烫后效果模拟：圆角方豆 + 左上高光 + 细闪颗粒，白底。 */
export function renderIronedPreview(
  pattern: BeadPattern,
  targetW: number,
  targetH: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new ExportError("E_EXPORT", "cannot acquire 2d context for ironed preview");
  }
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, targetW, targetH);

  const scale = Math.min(targetW / pattern.width, targetH / pattern.height);
  const gridW = pattern.width * scale;
  const gridH = pattern.height * scale;
  const originX = (targetW - gridW) / 2;
  const originY = (targetH - gridH) / 2;

  for (let gy = 0; gy < pattern.height; gy += 1) {
    for (let gx = 0; gx < pattern.width; gx += 1) {
      const paletteIndex = pattern.cells[gy * pattern.width + gx] ?? EMPTY_CELL;
      if (paletteIndex === EMPTY_CELL) continue;
      const color = pattern.palette[paletteIndex];
      if (color === undefined) continue;
      const px = originX + gx * scale;
      const py = originY + gy * scale;
      const inset = Math.max(0.5, scale * 0.06);
      const size = scale - inset * 2;
      ctx.fillStyle = color.hex;
      roundedPath(ctx, px + inset, py + inset, size, size, size * 0.32);
      ctx.fill();
      // 熔合后的顶面高光。
      const gloss = ctx.createLinearGradient(px, py, px + scale, py + scale);
      gloss.addColorStop(0, "rgba(255, 255, 255, 0.30)");
      gloss.addColorStop(0.5, "rgba(255, 255, 255, 0.06)");
      gloss.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = gloss;
      roundedPath(ctx, px + inset, py + inset, size, size, size * 0.32);
      ctx.fill();
      // 细闪颗粒：约 1/7 的豆子带一颗小亮点。
      const seed = hash2(gx, gy);
      if (seed % 7 === 0) {
        const sx = px + inset + ((seed >>> 8) % 100) / 100 * size * 0.7 + size * 0.15;
        const sy = py + inset + ((seed >>> 16) % 100) / 100 * size * 0.7 + size * 0.15;
        ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(0.8, scale * 0.07), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  return canvas;
}

function drawCompare(
  ctx: CanvasRenderingContext2D,
  pattern: BeadPattern,
  layout: ShareCardLayout,
  options: ShareCardOptions,
): void {
  const compare = layout.compare;
  if (!compare) return;
  const innerW = CARD_W - PAD * 2;
  const leftX = PAD;
  const rightX = PAD + compare.panelW + compare.gap;
  const source = options.source ?? null;

  const panels: Array<{ x: number; label: string; draw: () => void }> = [];

  if (source) {
    panels.push({
      x: leftX,
      label: "原图",
      draw: () => drawCoverImage(ctx, source, leftX, compare.y, compare.panelW, compare.panelH),
    });
  }
  const ironedX = source ? rightX : leftX + (innerW - compare.panelW) / 2;
  panels.push({
    x: ironedX,
    label: "烫后效果模拟",
    draw: () => {
      const preview = renderIronedPreview(pattern, compare.panelW, compare.panelH);
      ctx.save();
      roundedPath(ctx, ironedX, compare.y, compare.panelW, compare.panelH, 18);
      ctx.clip();
      ctx.drawImage(preview, ironedX, compare.y);
      ctx.restore();
    },
  });

  for (const panel of panels) {
    ctx.save();
    ctx.shadowColor = "rgba(120, 70, 60, 0.14)";
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 5;
    ctx.fillStyle = "#FFFFFF";
    roundedPath(ctx, panel.x, compare.y, compare.panelW, compare.panelH, 18);
    ctx.fill();
    ctx.restore();
    panel.draw();

    // 红色小竖条 + 标签。
    const labelY = compare.y + compare.panelH + COMPARE_LABEL_H / 2;
    ctx.save();
    ctx.fillStyle = ACCENT;
    roundedPath(ctx, panel.x + 2, labelY - 12, 5, 24, 2.5);
    ctx.fill();
    ctx.font = font(23, "600");
    ctx.fillStyle = INK;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(panel.label, panel.x + 18, labelY);
    ctx.restore();
  }
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  source: ShareCardSource,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const crop = source.crop ?? { x: 0, y: 0, width: source.width, height: source.height };
  const cropRatio = crop.width / crop.height;
  const panelRatio = w / h;
  // cover：裁掉超出部分，保持面板无留白。
  let sx = crop.x;
  let sy = crop.y;
  let sw = crop.width;
  let sh = crop.height;
  if (cropRatio > panelRatio) {
    sw = crop.height * panelRatio;
    sx = crop.x + (crop.width - sw) / 2;
  } else {
    sh = crop.width / panelRatio;
    sy = crop.y + (crop.height - sh) / 2;
  }
  ctx.save();
  roundedPath(ctx, x, y, w, h, 18);
  ctx.clip();
  ctx.drawImage(source.image, sx, sy, sw, sh, x, y, w, h);
  ctx.restore();
}

function drawFooter(
  ctx: CanvasRenderingContext2D,
  layout: ShareCardLayout,
  watermark: string,
): void {
  ctx.save();
  ctx.font = font(21);
  ctx.fillStyle = INK_FADED;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(CARD_FOOTER_ZH, PAD, layout.footer.y + FOOTER_H / 2);
  if (watermark) {
    ctx.textAlign = "right";
    ctx.fillText(watermark, CARD_W - PAD, layout.footer.y + FOOTER_H / 2);
  }
  ctx.restore();
}

export function renderShareCard(
  pattern: BeadPattern,
  options: ShareCardOptions = {},
): HTMLCanvasElement {
  const stats = assertExportReady(pattern);
  const usedColorCount = stats.byColor.filter((row) => row.count > 0).length;
  const layout = shareCardLayout(pattern, usedColorCount, options);
  const scale = options.scale === 2 ? 2 : 1;

  const canvas = document.createElement("canvas");
  canvas.width = layout.width * scale;
  canvas.height = layout.height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new ExportError("E_EXPORT", "cannot acquire 2d context for share card");
  }
  ctx.scale(scale, scale);

  drawBackground(ctx, layout);
  drawHeader(ctx, layout, pattern, stats);
  drawCardFrame(ctx, layout);
  drawGrid(ctx, pattern, layout);
  drawLegend(ctx, layout, stats);
  drawCompare(ctx, pattern, layout, options);
  drawFooter(ctx, layout, options.watermark ?? "");
  return canvas;
}

export async function exportShareCardPng(
  pattern: BeadPattern,
  options: ShareCardOptions = {},
): Promise<Uint8Array> {
  const canvas = renderShareCard(pattern, options);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });
  if (!blob) {
    throw new ExportError("E_EXPORT", "share card PNG encoding failed");
  }
  return new Uint8Array(await blob.arrayBuffer());
}
