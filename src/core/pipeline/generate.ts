/**
 * S10 · 生成流水线（纯函数编排，无 DOM）。
 *
 * 顺序固定：采样校验 → 色卡子集 → 最近邻匹配 → 可选抖动 → 局部优化 → 诊断 → 统计 → BeadPattern。
 * 每步之间不做隐式降级；任一步抛错则整体失败并保留错误 code。
 *
 * C5 · Alpha 语义（两种模式，见 docs/ALPHA_QUANTIZATION.md）：
 *
 * - `empty`（保留透明）：alpha < EMPTY_ALPHA_THRESHOLD 的格子记为空格（-1）。
 *   空格不消耗豆子，不进入色卡子集、最近邻匹配、误差扩散、局部优化与诊断；
 *   其 RGB 无论是什么（包括透明哨兵 0,0,0）都不会被读取，因而不会变成黑豆。
 * - `background`（透明转纯色）：每个格子都消耗豆子。alpha = 0 的格子没有任何
 *   可见内容，其 RGB 是哨兵值；本函数在进入任何算法前把这些格子统一替换为
 *   `backgroundHex`（缺省 `#FFFFFF`），保证透明区域不会被量化成黑色。
 *   半透明格（alpha > 0）保留 RGB：采样层已按所选 alphaPolicy 处理好可见色。
 *
 * 两种模式的共同红线：**透明像素不得映射为黑色拼豆**。回归测试见 alpha.test.ts。
 */

import { deltaE2000, deltaEOklab, hexToRgb, rgbToLab, rgbToOklab } from "../color";
import type { ColorMetricName, RGB } from "../color";
import { floydSteinberg } from "../dithering";
import { getModeProfile, refineLocally } from "../modes";
import { buildPaletteIndex, selectPaletteSubset } from "../palette";
import type { BeadColor as PaletteBeadColor } from "../palette";
import { EMPTY_CELL, computePaletteHash, computeStats, validatePattern } from "../pattern";
import type {
  BeadColor,
  BeadPattern,
  DitheringMode,
  GenerationSettings,
  ImageMode,
  PatternSource,
  PatternStats,
  TransparentPolicy,
} from "../pattern";
import { buildReport, DEFAULT_QUALITY_OPTIONS } from "../quality";
import type { DiagnosticReport } from "../quality";
import { EMPTY_ALPHA_THRESHOLD } from "../sampling";
import { PipelineError } from "./errors";
import type { PipelineStage } from "./protocol";

export interface GenerateProgress {
  stage: PipelineStage;
  done: number;
  total: number;
}

export interface GenerateHooks {
  onProgress?: (progress: GenerateProgress) => void;
  shouldCancel?: () => boolean;
}

export interface GenerateInput {
  rgb: Uint8ClampedArray;
  alpha: Uint8Array;
  width: number;
  height: number;
  palette: BeadColor[];
  paletteId: string;
  paletteVersion: string;
  maxColors: number;
  mode: ImageMode;
  dithering: DitheringMode;
  colorMetric: ColorMetricName;
  transparentPolicy: TransparentPolicy;
  ditherStrength: number;
  source: PatternSource;
  title: string;
  id: string;
  now?: string;
  backgroundHex?: string;
}

export interface GenerateResult {
  pattern: BeadPattern;
  diagnostic: DiagnosticReport;
  stats: PatternStats;
}

const MATCH_STRIDE = 32;
const EDGE_NORM_CIEDE2000 = 20;
const EDGE_NORM_OKLAB = 0.25;

/**
 * background 策略未显式提供背景色时的安全默认值。
 *
 * 为什么默认白色而不是报错：构图结果的透明背景是全 0（含 RGB 哨兵 0,0,0），
 * 缺省时若把哨兵当真实颜色就会生成黑豆。白色是“无背景色偏好”时最安全、
 * 最不意外的选择，也符合 C5「透明背景强制转纯色（如白色）」的约定。
 */
export const DEFAULT_TRANSPARENT_BACKGROUND_HEX = "#FFFFFF";

/** 背景色只接受 #RRGGBB；与 pattern/validate 的持久化约定保持一致（大小写不敏感）。 */
const BACKGROUND_HEX_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/** 解析后的透明度策略：empty 没有背景，background 一定有归一化后的背景色。 */
interface TransparencyResolution {
  readonly policy: TransparentPolicy;
  readonly backgroundHex: string | null;
  readonly backgroundRgb: RGB | null;
}

/**
 * 提前校验并归一化透明策略。
 *
 * 早失败的理由：`validatePattern` 也会校验 settings.backgroundHex，但那发生在
 * 所有像素计算与诊断之后。参数错误应在进入流水线前就给出明确 code。
 */
function resolveTransparency(
  policy: TransparentPolicy,
  backgroundHex: string | undefined,
): TransparencyResolution {
  if (policy !== "empty" && policy !== "background") {
    throw new PipelineError(
      "E_INVALID_SETTINGS",
      `transparentPolicy must be "empty" or "background"; received ${JSON.stringify(policy)}`,
    );
  }
  if (policy === "empty") {
    return { policy, backgroundHex: null, backgroundRgb: null };
  }

  const raw = backgroundHex ?? DEFAULT_TRANSPARENT_BACKGROUND_HEX;
  if (!BACKGROUND_HEX_PATTERN.test(raw)) {
    throw new PipelineError(
      "E_INVALID_SETTINGS",
      `backgroundHex must be #RRGGBB when transparentPolicy is "background"; received ${JSON.stringify(raw)}`,
    );
  }
  const normalized = raw.toUpperCase();
  return { policy, backgroundHex: normalized, backgroundRgb: hexToRgb(normalized) };
}

function throwIfCancelled(hooks: GenerateHooks | undefined): void {
  if (hooks?.shouldCancel?.()) {
    throw new PipelineError("E_CANCELLED", "generation cancelled");
  }
}

function report(hooks: GenerateHooks | undefined, progress: GenerateProgress): void {
  hooks?.onProgress?.(progress);
}

function readRgb(rgb: Uint8ClampedArray, cellIndex: number): RGB {
  const offset = cellIndex * 3;
  return {
    r: rgb[offset] ?? 0,
    g: rgb[offset + 1] ?? 0,
    b: rgb[offset + 2] ?? 0,
  };
}

/**
 * 该格是否为空（透明）格。
 *
 * 阈值必须与采样层完全一致：`sampleToGrid` 在 empty 策略下把 avgAlpha < 128
 * 的格子写成 alpha = 0，但直接调用方（测试 / 未来的 C6 合成直通）可能传入
 * 未经过采样的原始 alpha。统一用 `EMPTY_ALPHA_THRESHOLD` 判定，才能保证
 * “半透明但低于阈值”的像素同样不会被当成实心豆。
 */
function isEmptyCell(
  alpha: Uint8Array,
  cellIndex: number,
  transparency: TransparencyResolution,
): boolean {
  if (transparency.policy !== "empty") return false;
  return (alpha[cellIndex] ?? 0) < EMPTY_ALPHA_THRESHOLD;
}

/**
 * 返回用于后续所有颜色计算的 RGB 缓冲。
 *
 * empty 策略：原样返回。空格的颜色永远不会被读取。
 * background 策略：仅把 alpha = 0 的格子替换成背景色。这些格子没有任何可见
 * 贡献，其 RGB 是未定义哨兵（构图层与采样层都用 0,0,0），若不替换就会被
 * 最近邻匹配成黑豆，违反验收红线。alpha > 0 的半透明格保留原色：
 * 采样层若用 background 策略已合成到背景上，若用 empty 策略则是可见内容的
 * 预乘还原色；二次合成会把边缘进一步压向背景色。
 *
 * 无 alpha = 0 格子时不复制缓冲，避免为常规图片增加无谓内存。
 */
function buildEffectiveRgb(
  rgb: Uint8ClampedArray,
  alpha: Uint8Array,
  cellCount: number,
  transparency: TransparencyResolution,
): Uint8ClampedArray {
  const background = transparency.backgroundRgb;
  if (background === null) return rgb;

  let hasFullyTransparent = false;
  for (let index = 0; index < cellCount; index += 1) {
    if ((alpha[index] ?? 0) === 0) {
      hasFullyTransparent = true;
      break;
    }
  }
  if (!hasFullyTransparent) return rgb;

  const effective = new Uint8ClampedArray(rgb);
  for (let index = 0; index < cellCount; index += 1) {
    if ((alpha[index] ?? 0) !== 0) continue;
    const offset = index * 3;
    effective[offset] = background.r;
    effective[offset + 1] = background.g;
    effective[offset + 2] = background.b;
  }
  return effective;
}

function colorDelta(metric: ColorMetricName, a: RGB, b: RGB): number {
  return metric === "oklab"
    ? deltaEOklab(rgbToOklab(a), rgbToOklab(b))
    : deltaE2000(rgbToLab(a), rgbToLab(b));
}

function asPaletteColors(palette: readonly BeadColor[]): PaletteBeadColor[] {
  return palette.map((color) => ({
    code: color.code,
    name: color.name,
    hex: color.hex,
    manufacturer: color.manufacturer,
    ...(color.series === undefined ? {} : { series: color.series }),
  }));
}

function collectSamples(
  rgb: Uint8ClampedArray,
  alpha: Uint8Array,
  cellCount: number,
  transparency: TransparencyResolution,
): RGB[] {
  const samples: RGB[] = [];
  for (let index = 0; index < cellCount; index += 1) {
    if (isEmptyCell(alpha, index, transparency)) continue;
    samples.push(readRgb(rgb, index));
  }
  return samples;
}

function pickWorkingPalette(
  fullPalette: readonly BeadColor[],
  samples: readonly RGB[],
  maxColors: number,
  metric: ColorMetricName,
): BeadColor[] {
  const paletteColors = asPaletteColors(fullPalette);
  const subset = selectPaletteSubset(samples, paletteColors, maxColors, metric);
  return subset.map((index) => {
    const color = fullPalette[index];
    if (color === undefined) {
      throw new PipelineError("E_PIPELINE", `subset index ${index} is outside the source palette`);
    }
    return color;
  });
}

/**
 * 全透明图（empty 策略）没有可见样本时的色卡兜底。
 *
 * `selectPaletteSubset` 的契约要求样本非空，但“所有格子都是空格、零颗豆”是
 * 合法的生成结果，不应报错。这里按色卡原顺序取前 min(maxColors, size) 个颜色
 * 占位：结果确定、`BeadPattern.palette` 仍非空，且没有任何格子引用它们，
 * 统计的 beadCount 为 0。正常图片永远不会走到这条分支。
 */
function pickFallbackPalette(fullPalette: readonly BeadColor[], maxColors: number): BeadColor[] {
  return fullPalette.slice(0, Math.min(maxColors, fullPalette.length));
}

function computeEdgeStrength(
  rgb: Uint8ClampedArray,
  alpha: Uint8Array,
  width: number,
  height: number,
  transparency: TransparencyResolution,
  metric: ColorMetricName,
): Float32Array {
  const cellCount = width * height;
  const out = new Float32Array(cellCount);
  const norm = metric === "oklab" ? EDGE_NORM_OKLAB : EDGE_NORM_CIEDE2000;
  const offsets: ReadonlyArray<readonly [number, number]> = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      // 空格不参与边缘强度：空格的 RGB 是哨兵值，把它当成颜色会虚增边界强度。
      if (isEmptyCell(alpha, index, transparency)) {
        out[index] = 0;
        continue;
      }
      const here = readRgb(rgb, index);
      let maxDelta = 0;
      for (const [dx, dy] of offsets) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbor = ny * width + nx;
        if (isEmptyCell(alpha, neighbor, transparency)) continue;
        const delta = colorDelta(metric, here, readRgb(rgb, neighbor));
        if (delta > maxDelta) maxDelta = delta;
      }
      const strength = maxDelta / norm;
      out[index] = strength < 0 ? 0 : strength > 1 ? 1 : strength;
    }
  }
  return out;
}

function computePerCellDelta(
  rgb: Uint8ClampedArray,
  cells: Int16Array,
  paletteRgb: readonly RGB[],
  metric: ColorMetricName,
): Float32Array {
  const out = new Float32Array(cells.length);
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index] ?? EMPTY_CELL;
    if (cell === EMPTY_CELL) {
      out[index] = 0;
      continue;
    }
    const mapped = paletteRgb[cell];
    if (mapped === undefined) {
      throw new PipelineError("E_PIPELINE", `cell ${index} points at missing palette[${cell}]`);
    }
    out[index] = colorDelta(metric, readRgb(rgb, index), mapped);
  }
  return out;
}

function resolveDithering(mode: ImageMode, requested: DitheringMode): DitheringMode {
  const profile = getModeProfile(mode);
  if (!profile.allowUserDithering && requested !== "none") {
    throw new PipelineError(
      "E_INVALID_SETTINGS",
      `${mode} mode forbids dithering; received ${requested}`,
    );
  }
  return requested;
}

/**
 * 装配一次完整生成。采样阶段在此校验已完成的面积采样缓冲
 * （Canvas 取像素仍在主线程；sampleToGrid 的结果作为本函数输入，避免 core 依赖 DOM）。
 */
export function generatePattern(input: GenerateInput, hooks: GenerateHooks = {}): GenerateResult {
  const { width, height, rgb, alpha, transparentPolicy } = input;
  const cellCount = width * height;

  throwIfCancelled(hooks);
  report(hooks, { stage: "sample", done: 0, total: cellCount });
  if (rgb.length !== cellCount * 3) {
    throw new PipelineError(
      "E_INVALID_SAMPLE",
      `rgb length ${rgb.length} !== width*height*3 ${cellCount * 3}`,
    );
  }
  if (alpha.length !== cellCount) {
    throw new PipelineError(
      "E_INVALID_SAMPLE",
      `alpha length ${alpha.length} !== width*height ${cellCount}`,
    );
  }
  if (input.palette.length < 1) {
    throw new PipelineError("E_INVALID_SETTINGS", "palette must contain at least one real color");
  }
  if (!Number.isInteger(input.maxColors) || input.maxColors < 1) {
    throw new PipelineError(
      "E_INVALID_SETTINGS",
      `maxColors must be an integer >= 1; received ${String(input.maxColors)}`,
    );
  }
  // 透明策略与背景色必须在任何像素计算之前解析完毕，错误码固定为 E_INVALID_SETTINGS。
  const transparency = resolveTransparency(transparentPolicy, input.backgroundHex);
  // background 策略下把 alpha=0 的哨兵色替换成背景色，后续所有步骤只读这份缓冲。
  const effectiveRgb = buildEffectiveRgb(rgb, alpha, cellCount, transparency);
  report(hooks, { stage: "sample", done: cellCount, total: cellCount });

  throwIfCancelled(hooks);
  report(hooks, { stage: "subset", done: 0, total: 1 });
  const samples = collectSamples(effectiveRgb, alpha, cellCount, transparency);
  const workingPalette =
    samples.length === 0
      ? pickFallbackPalette(input.palette, input.maxColors)
      : pickWorkingPalette(input.palette, samples, input.maxColors, input.colorMetric);
  const paletteColors = asPaletteColors(workingPalette);
  const index = buildPaletteIndex(paletteColors, input.colorMetric);
  const paletteRgb = workingPalette.map((color) => hexToRgb(color.hex));
  report(hooks, { stage: "subset", done: 1, total: 1 });

  throwIfCancelled(hooks);
  const cells = new Int16Array(cellCount);
  const rgbSamples: RGB[] = new Array<RGB>(cellCount);
  const alphaMask: boolean[] = new Array<boolean>(cellCount);
  for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
    throwIfCancelled(hooks);
    const empty = isEmptyCell(alpha, cellIndex, transparency);
    alphaMask[cellIndex] = empty;
    const sample = readRgb(effectiveRgb, cellIndex);
    rgbSamples[cellIndex] = sample;
    if (empty) {
      cells[cellIndex] = EMPTY_CELL;
    } else {
      cells[cellIndex] = index.nearest(sample).index;
    }
    if (cellIndex % MATCH_STRIDE === MATCH_STRIDE - 1 || cellIndex === cellCount - 1) {
      report(hooks, { stage: "match", done: cellIndex + 1, total: cellCount });
    }
  }

  throwIfCancelled(hooks);
  const dithering = resolveDithering(input.mode, input.dithering);
  report(hooks, { stage: "dither", done: 0, total: 1 });
  let workingCells = cells;
  if (dithering === "floyd-steinberg") {
    const dithered = floydSteinberg(rgbSamples, alphaMask, width, height, paletteColors, index, {
      strength: input.ditherStrength,
      metric: input.colorMetric,
    });
    workingCells = new Int16Array(dithered.indices);
  }
  report(hooks, { stage: "dither", done: 1, total: 1 });

  throwIfCancelled(hooks);
  report(hooks, { stage: "refine", done: 0, total: 1 });
  const edgeStrength = computeEdgeStrength(
    effectiveRgb,
    alpha,
    width,
    height,
    transparency,
    input.colorMetric,
  );
  let perCellDelta = computePerCellDelta(effectiveRgb, workingCells, paletteRgb, input.colorMetric);
  workingCells = new Int16Array(
    refineLocally({
      width,
      height,
      cells: workingCells,
      palette: paletteColors,
      index,
      metric: input.colorMetric,
      perCellDelta,
      edgeStrength,
      profile: getModeProfile(input.mode),
    }),
  );
  perCellDelta = computePerCellDelta(effectiveRgb, workingCells, paletteRgb, input.colorMetric);
  report(hooks, { stage: "refine", done: 1, total: 1 });

  throwIfCancelled(hooks);
  report(hooks, { stage: "diagnose", done: 0, total: 1 });
  const diagnostic = buildReport(
    { width, height, cells: workingCells },
    perCellDelta,
    DEFAULT_QUALITY_OPTIONS,
  );

  const settings: GenerationSettings = {
    maxColors: input.maxColors,
    dithering,
    colorMetric: input.colorMetric,
    transparentPolicy: transparency.policy,
  };
  if (transparency.backgroundHex !== null) {
    settings.backgroundHex = transparency.backgroundHex;
  }

  const now = input.now ?? new Date().toISOString();
  const pattern: BeadPattern = {
    schemaVersion: "1.0",
    id: input.id,
    title: input.title,
    width,
    height,
    cells: workingCells,
    palette: workingPalette,
    mode: input.mode,
    paletteId: input.paletteId,
    paletteVersion: input.paletteVersion,
    paletteHash: computePaletteHash(workingPalette),
    settings,
    source: input.source,
    createdAt: now,
    updatedAt: now,
  };
  validatePattern(pattern);
  const stats = computeStats(pattern);
  report(hooks, { stage: "diagnose", done: 1, total: 1 });

  return { pattern, diagnostic, stats };
}
