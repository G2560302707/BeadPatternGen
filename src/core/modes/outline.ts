/**
 * S11 · 主体描边、内部边界锐化与特征保护锁（纯函数，确定性）。
 *
 * 三个职责对应 docs/算法精修-边界与特征.md 的三个问题：
 *
 * 1. **主体描边（rim outline）**：与空格（透明背景）相邻的最外圈格子是主体轮廓。
 *    市面优秀图纸（参考图集实测）在轮廓上用 1 格深色描边，描边色看主体色调：
 *    深色主体用中灰（黑上黑无分离度）、暖调主体用暖深灰、其余用近黑。
 *    实现方式是把轮廓格的采样色**预写**为描边色，再参与量化与选色
 *    （选色预留 1 个描边位），后续 flatten / refine 把描边当作普通色块维护。
 *
 * 2. **内部边界锐化（boundary snap）**：两色块交界格的采样色是两侧的平均，
 *    量化后随机落到任一侧，形成边缘噪点带。锐化在量化后进行：骑在强边界上的
 *    格子若与「较深一侧」的色差在容差内，就归入深色侧——交界带收敛、边界变利落。
 *
 * 3. **特征保护锁（feature lock）**：高对比小色块（眼睛高光、瞳孔、小图标）
 *    是有意细节。flatten 的多数投票与 refine 的孤立豆修复都不得改写锁定格。
 *
 * 确定性契约：所有扫描 row-major；argmax/argmin 严格比较，平局取更小下标；
 * 不用随机数、不用 Map/Set 遍历顺序；同一输入两次调用结果相同。
 */

import { deltaE2000, deltaEOklab, hexToRgb, rgbToLab, rgbToOklab } from "../color";
import type { ColorMetricName, RGB } from "../color";
import type { BeadColor } from "../palette";

const EMPTY_CELL = -1;

/** 8 邻域偏移（描边检测用，保证斜向轮廓连续）。顺序固定，只影响遍历先后。 */
const NEIGHBORS_8: readonly (readonly [number, number])[] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

/** 4 邻域偏移（边界锐化 / 特征锁用）。顺序固定：左 → 右 → 上 → 下。 */
const NEIGHBORS_4: readonly (readonly [number, number])[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

/** 空格判定阈值，必须与采样层 / generate.ts 的 EMPTY_ALPHA_THRESHOLD 一致。 */
export const OUTLINE_EMPTY_ALPHA_THRESHOLD = 128;

/** Lab 与 Oklab 结构同形；L 均随明度单调，可统一比较「谁更暗」。 */
interface SpacePoint {
  readonly L: number;
  readonly a: number;
  readonly b: number;
}

function toPoint(rgb: RGB, metric: ColorMetricName): SpacePoint {
  return metric === "oklab" ? rgbToOklab(rgb) : rgbToLab(rgb);
}

function colorDelta(a: RGB, b: RGB, metric: ColorMetricName): number {
  return metric === "oklab"
    ? deltaEOklab(rgbToOklab(a), rgbToOklab(b))
    : deltaE2000(rgbToLab(a), rgbToLab(b));
}

function paletteRgbAt(palette: readonly BeadColor[], index: number): RGB {
  const entry = palette[index];
  if (entry === undefined) {
    throw new RangeError(`outline: palette[${index}] is missing`);
  }
  return hexToRgb(entry.hex);
}

function assertGridShape(width: number, height: number, length: number, label: string): void {
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new RangeError(`outline: width/height must be positive integers; got ${width}×${height}`);
  }
  if (length !== width * height) {
    throw new RangeError(`outline: ${label}.length must equal width*height=${width * height}; got ${length}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. 主体描边
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 轮廓掩码：非空格的 8 邻域中存在空格或画布外 → 1。
 *
 * 画布外按空格处理：满幅主体（无透明洞）也会在最外圈得到描边，
 * 这与「裁切主体不贴边」的常规构图不冲突，且规则单一可预测。
 * 8 邻接让斜向轮廓（台阶边缘）连成线，不会出现间隔断点。
 */
export function computeRimMask(
  alpha: Uint8Array,
  width: number,
  height: number,
  emptyThreshold: number = OUTLINE_EMPTY_ALPHA_THRESHOLD,
): Uint8Array {
  assertGridShape(width, height, alpha.length, "alpha");

  const rim = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if ((alpha[index] ?? 0) < emptyThreshold) continue;
      for (const [dx, dy] of NEIGHBORS_8) {
        const nx = x + dx;
        const ny = y + dy;
        const outside = nx < 0 || ny < 0 || nx >= width || ny >= height;
        if (outside) {
          rim[index] = 1;
          break;
        }
        if ((alpha[ny * width + nx] ?? 0) < emptyThreshold) {
          rim[index] = 1;
          break;
        }
      }
    }
  }
  return rim;
}

/** 主体平均 Lab 的暖扇区判定参数（CIEDE2000 空间标定）。
 *  暖扇区 40°..85° 覆盖肤色 / 棕毛 / 橙黄；彩度下限排除「灰到看不出色相」。 */
const WARM_HUE_MIN_DEG = 40;
const WARM_HUE_MAX_DEG = 85;
const WARM_CHROMA_MIN = 8;

/** 描边锚色目标（映射到全色卡最近的真实色，目标本身绝不出现在输出里）。 */
const ANCHOR_TARGET_DARK_SUBJECT = "#2C2C2C";
const ANCHOR_TARGET_WARM = "#5A4038";
const ANCHOR_TARGET_DEFAULT = "#0A0A0A";

export interface OutlineAnchor {
  /** 全色卡下标（palette 原数组）。 */
  readonly index: number;
  /** 锚色真实 RGB（来自 palette[index].hex）。 */
  readonly rgb: RGB;
  /** 规则名，用于诊断与测试。 */
  readonly rule: "dark-subject" | "warm-subject" | "default";
}

/**
 * 按主体色调选描边锚色。
 *
 * - 主体平均明度 L* < darkSubjectMaxL → 中灰（深色主体上近黑描边无分离度）；
 * - 暖扇区（hue 40°..85° 且彩度 ≥ 8）→ 暖深灰；
 * - 其余 → 近黑（市面动漫描边主流）。
 *
 * 平局（多个色卡色到目标色等距）取更小下标。
 */
export function chooseOutlineAnchor(
  samples: readonly RGB[],
  palette: readonly BeadColor[],
  metric: ColorMetricName,
  darkSubjectMaxL: number,
): OutlineAnchor {
  if (samples.length === 0) {
    throw new RangeError("outline: samples must be non-empty to choose an anchor");
  }
  if (palette.length === 0) {
    throw new RangeError("outline: palette must be non-empty");
  }

  let sumL = 0;
  let sumA = 0;
  let sumB = 0;
  for (const sample of samples) {
    const point = toPoint(sample, metric);
    sumL += point.L;
    sumA += point.a;
    sumB += point.b;
  }
  const mean = { L: sumL / samples.length, a: sumA / samples.length, b: sumB / samples.length };

  let targetHex: string;
  let rule: OutlineAnchor["rule"];
  if (mean.L < darkSubjectMaxL) {
    targetHex = ANCHOR_TARGET_DARK_SUBJECT;
    rule = "dark-subject";
  } else {
    const chroma = Math.sqrt(mean.a * mean.a + mean.b * mean.b);
    const hueDeg = (Math.atan2(mean.b, mean.a) * 180) / Math.PI;
    if (chroma >= WARM_CHROMA_MIN && hueDeg >= WARM_HUE_MIN_DEG && hueDeg <= WARM_HUE_MAX_DEG) {
      targetHex = ANCHOR_TARGET_WARM;
      rule = "warm-subject";
    } else {
      targetHex = ANCHOR_TARGET_DEFAULT;
      rule = "default";
    }
  }

  const target = hexToRgb(targetHex);
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < palette.length; index += 1) {
    const distance = colorDelta(target, paletteRgbAt(palette, index), metric);
    // 严格 <，平局保留更小下标。
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return { index: bestIndex, rgb: paletteRgbAt(palette, bestIndex), rule };
}

/**
 * 把轮廓格的采样色预写为锚色。返回**新缓冲**，绝不修改入参。
 *
 * 预写而非量化后强制改格子的理由：让描边色参与 k-means 选色（自然形成描边簇）、
 * 让 edgeStrength 在轮廓处升高（refine 的边缘保护自动生效）、
 * 让最近邻映射对轮廓格精确命中锚色（ΔE = 0）。
 */
export function applyOutlineToSamples(
  rgb: Uint8ClampedArray,
  rimMask: Uint8Array,
  anchor: RGB,
): Uint8ClampedArray {
  if (rgb.length !== rimMask.length * 3) {
    throw new RangeError(
      `outline: rgb.length must equal rimMask.length*3=${rimMask.length * 3}; got ${rgb.length}`,
    );
  }
  const out = new Uint8ClampedArray(rgb);
  for (let index = 0; index < rimMask.length; index += 1) {
    if (rimMask[index] !== 1) continue;
    out[index * 3] = anchor.r;
    out[index * 3 + 1] = anchor.g;
    out[index * 3 + 2] = anchor.b;
  }
  return out;
}

// ── S11.1 · 描边中和 ─────────────────────────────────────────────────────────

/** 调和描边的深色族上限：映射候选色卡色的 Lab/Oklab L 必须低于该值。 */
const BLEND_DARK_MAX_L = 45;
/** 调和映射色与全局锚色允许的最大色差，超过则退回锚色（防跑出怪色）。 */
const BLEND_ANCHOR_GUARD_DELTA = 40;

export interface RimBlendOptions {
  width: number;
  height: number;
  /** 原始采样缓冲（描边前），不会被修改。 */
  rgb: Uint8ClampedArray;
  alpha: Uint8Array;
  palette: readonly BeadColor[];
  metric: ColorMetricName;
  rimMask: Uint8Array;
  /** 全局兜底锚色 RGB（来自 chooseOutlineAnchor）。 */
  anchor: RGB;
  /** 内侧参考色 L 低于该值的轮廓格不描（深色豁免断线）。 */
  skipL: number;
}

export interface RimBlendResult {
  /** 预写后的新采样缓冲。 */
  rgb: Uint8ClampedArray;
  /** 实际描边格数（调和色或锚色）。 */
  painted: number;
  /** 深色豁免格数。 */
  skipped: number;
}

/**
 * S11.1 · 调和描边：边线 = 主体局部色的暗化版，深色段自然断线。
 *
 * 每个轮廓格：
 * 1. 内侧参考色 = 4 邻中非空格采样色的度量空间均值（紧邻主体色）；
 *    没有非空邻格（孤立/全轮廓细部）时用全局锚色直接描。
 * 2. 内侧 L < skipL → 豁免（黑发边保持黑发，不重复加深）。
 * 3. 调和目标 = 内侧色 L 压到 max(10, L×0.3)、a/b 保持 → 映射全色卡
 *    深色族（L < 45）最近真实色；与全局锚色 ΔE > 40 时退回锚色。
 *
 * 确定性：row-major、均值累加顺序固定、最近邻严格比较平局取小下标。
 */
export function blendRimColors(options: RimBlendOptions): RimBlendResult {
  const { width, height, rgb, alpha, palette, metric, rimMask, anchor, skipL } = options;
  assertGridShape(width, height, rimMask.length, "rimMask");
  if (rgb.length !== rimMask.length * 3) {
    throw new RangeError(
      `outline: rgb.length must equal rimMask.length*3=${rimMask.length * 3}; got ${rgb.length}`,
    );
  }
  if (alpha.length !== rimMask.length) {
    throw new RangeError(
      `outline: alpha.length must equal rimMask.length=${rimMask.length}; got ${alpha.length}`,
    );
  }
  if (!Number.isFinite(skipL) || skipL < 0) {
    throw new RangeError(`outline: skipL must be a non-negative finite number; got ${String(skipL)}`);
  }

  const out = new Uint8ClampedArray(rgb);
  const darkIndices: number[] = [];
  for (let index = 0; index < palette.length; index += 1) {
    if (toPoint(paletteRgbAt(palette, index), metric).L < BLEND_DARK_MAX_L) {
      darkIndices.push(index);
    }
  }
  const anchorPoint = toPoint(anchor, metric);

  let painted = 0;
  let skipped = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (rimMask[index] !== 1) continue;

      // 1. 内侧参考色：4 邻非空格的均值（空格哨兵不参与）。
      let sumL = 0;
      let sumA = 0;
      let sumB = 0;
      let innerCount = 0;
      for (const [dx, dy] of NEIGHBORS_4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighborIndex = ny * width + nx;
        if ((alpha[neighborIndex] ?? 0) < OUTLINE_EMPTY_ALPHA_THRESHOLD) continue;
        const point = toPoint(readSample(rgb, neighborIndex), metric);
        sumL += point.L;
        sumA += point.a;
        sumB += point.b;
        innerCount += 1;
      }

      if (innerCount === 0) {
        // 细部（1 格宽）没有内侧参考：描全局锚色，保持细线可读。
        out[index * 3] = anchor.r;
        out[index * 3 + 1] = anchor.g;
        out[index * 3 + 2] = anchor.b;
        painted += 1;
        continue;
      }

      const inner = { L: sumL / innerCount, a: sumA / innerCount, b: sumB / innerCount };
      // 2. 深色豁免：内侧本身很深（黑发/深衣）→ 不重复加深。
      if (inner.L < skipL) {
        skipped += 1;
        continue;
      }

      // 3. 调和目标：保持色相，压暗明度。
      const blendTarget: SpacePoint = {
        L: Math.max(10, inner.L * 0.3),
        a: inner.a,
        b: inner.b,
      };
      let chosenRgb: RGB = anchor;
      const candidates = darkIndices.length > 0 ? darkIndices : null;
      if (candidates !== null) {
        let bestIndex = -1;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (const candidate of candidates) {
          const candidatePoint = toPoint(paletteRgbAt(palette, candidate), metric);
          const distance =
            metric === "oklab"
              ? deltaEOklab(blendTarget, candidatePoint)
              : deltaE2000(blendTarget, candidatePoint);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = candidate;
          }
        }
        if (bestIndex >= 0) {
          const mapped = paletteRgbAt(palette, bestIndex);
          const mappedPoint = toPoint(mapped, metric);
          const anchorDelta =
            metric === "oklab" ? deltaEOklab(mappedPoint, anchorPoint) : deltaE2000(mappedPoint, anchorPoint);
          // 兜底：调和结果离锚色太远（怪色）时退回锚色。
          if (anchorDelta <= BLEND_ANCHOR_GUARD_DELTA) {
            chosenRgb = mapped;
          }
        }
      }
      out[index * 3] = chosenRgb.r;
      out[index * 3 + 1] = chosenRgb.g;
      out[index * 3 + 2] = chosenRgb.b;
      painted += 1;
    }
  }
  return { rgb: out, painted, skipped };
}

/** S11.1 · 描边强度 → 深色豁免阈值。
 *  强度 1 → 30（几乎全描）；0.75 → 46（深段豁免的中和档）；
 *  0 → 95（连浅色主体也豁免，描边实际关闭）。 */
export function rimSkipThreshold(rimStrength: number): number {
  if (!Number.isFinite(rimStrength) || rimStrength < 0 || rimStrength > 1) {
    throw new RangeError(`outline: rimStrength must be within [0, 1]; got ${String(rimStrength)}`);
  }
  return 30 + (1 - rimStrength) * 65;
}

/**
 * 选色结果并入描边锚色下标，保证描边色一定在工作色板内。
 *
 * 契约：`selected` 长度 ≤ maxColors - 1；返回升序去重数组，长度 ≤ maxColors。
 * 已包含锚色时原样（排序副本）返回——此时调用方没有为描边牺牲任何色位。
 */
export function reserveOutlineIndex(
  selected: readonly number[],
  anchorIndex: number,
  maxColors: number,
): number[] {
  if (selected.some((value) => value === anchorIndex)) {
    return [...selected].sort((first, second) => first - second);
  }
  const merged = [...selected, anchorIndex];
  merged.sort((first, second) => first - second);
  if (merged.length > maxColors) {
    throw new RangeError(
      `outline: reserved palette exceeds maxColors (${merged.length} > ${maxColors}); ` +
        "caller must select at most maxColors-1 before reservation",
    );
  }
  return merged;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. 特征保护锁
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 高对比小色块锁定掩码。
 *
 * 判定：同色 4 连通分量尺寸 ≤ maxSize，且与「环绕主色」（分量外非空 4 邻格中
 * 出现次数最多的颜色，平局取更小色卡下标）的色差 ≥ minContrast。
 *
 * 典型被锁对象：眼白中的深色瞳孔、浅色脸上的黑点眼、衣服上的小图标。
 * 典型不锁对象：色块内部 ΔE 很小的散点（那是要被 flatten 收敛的斑噪）、
 * 大色块（尺寸超限）。锁定格在 flatten / snap / refine 中一律不改写。
 */
export function computeFeatureLock(
  cells: Int16Array,
  width: number,
  height: number,
  palette: readonly BeadColor[],
  metric: ColorMetricName,
  maxSize: number,
  minContrast: number,
): Uint8Array {
  assertGridShape(width, height, cells.length, "cells");
  if (!Number.isInteger(maxSize) || maxSize < 1) {
    throw new RangeError(`outline: maxSize must be a positive integer; got ${String(maxSize)}`);
  }
  if (!Number.isFinite(minContrast) || minContrast < 0) {
    throw new RangeError(`outline: minContrast must be non-negative; got ${String(minContrast)}`);
  }

  const count = width * height;
  const locked = new Uint8Array(count);
  const visited = new Uint8Array(count);
  const stack: number[] = [];
  const member: number[] = [];

  for (let start = 0; start < count; start += 1) {
    if (visited[start] !== 0) continue;
    const color = cells[start];
    if (color === undefined || color === EMPTY_CELL) {
      visited[start] = 1;
      continue;
    }

    // 完整遍历整个连通分量（visited 必须覆盖全部成员），
    // 但 member 只收集前 maxSize + 1 个：超限即标记 overflow，整个分量不锁。
    // 若在此处提前 break，未访问的同色格会在外层循环被当成独立小分量——
    // 大色块被截断成幻影「小特征」而误锁，是曾经的真实缺陷。
    stack.length = 0;
    member.length = 0;
    let overflow = false;
    stack.push(start);
    visited[start] = 1;
    while (stack.length > 0) {
      const index = stack.pop();
      if (index === undefined) break;
      if (member.length < maxSize) {
        member.push(index);
      } else {
        overflow = true;
      }
      const x = index % width;
      const y = (index - x) / width;
      for (const [dx, dy] of NEIGHBORS_4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbor = ny * width + nx;
        if (visited[neighbor] !== 0 || cells[neighbor] !== color) continue;
        visited[neighbor] = 1;
        stack.push(neighbor);
      }
    }
    if (overflow) continue;

    // 环绕主色：分量外非空 4 邻格的颜色直方图（数组按色卡下标计数，遍历顺序固定）。
    const histogram = new Map<number, number>();
    for (const index of member) {
      const x = index % width;
      const y = (index - x) / width;
      for (const [dx, dy] of NEIGHBORS_4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighborIndex = ny * width + nx;
        const neighborColor = cells[neighborIndex];
        if (neighborColor === undefined || neighborColor === EMPTY_CELL) continue;
        if (cells[neighborIndex] === cells[index]) continue; // 同色邻格属于另一分量（被尺寸截断时）
        histogram.set(neighborColor, (histogram.get(neighborColor) ?? 0) + 1);
      }
    }
    if (histogram.size === 0) continue;

    // 平局取更小色卡下标：先找最大计数，再取满足计数的最小下标。
    let bestCount = 0;
    for (const value of histogram.values()) {
      if (value > bestCount) bestCount = value;
    }
    let dominant = Number.POSITIVE_INFINITY;
    for (const [color, value] of histogram) {
      if (value === bestCount && color < dominant) dominant = color;
    }

    const contrast = colorDelta(
      paletteRgbAt(palette, color),
      paletteRgbAt(palette, dominant),
      metric,
    );
    if (contrast >= minContrast) {
      for (const index of member) locked[index] = 1;
    }
  }
  return locked;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. 内部边界锐化
// ─────────────────────────────────────────────────────────────────────────────

export interface SnapOptions {
  width: number;
  height: number;
  /** 量化后的格子（flatten 之后、refine 之前）。不会被修改。 */
  cells: Int16Array;
  /** 采样色缓冲（描边预写之后的那份），长度 = width*height*3。 */
  rgb: Uint8ClampedArray;
  palette: readonly BeadColor[];
  metric: ColorMetricName;
  /** 触发锐化的最小相邻采样色差（CIEDE2000 / Oklab 单位）。 */
  snapDelta: number;
  /** 归入深色侧允许付出的保真度上限。 */
  snapTolerance: number;
  /** 锁定格不改写（可空）。 */
  locked?: Uint8Array | null;
  /** 轮廓格不改写（描边已由预写保证，可空）。 */
  rimMask?: Uint8Array | null;
}

function readSample(rgb: Uint8ClampedArray, index: number): RGB {
  const offset = index * 3;
  return {
    r: rgb[offset] ?? 0,
    g: rgb[offset + 1] ?? 0,
    b: rgb[offset + 2] ?? 0,
  };
}

/**
 * 边界锐化：骑在强边界上的格子归入较深一侧。
 *
 * 单趟 row-major 扫描。每格：
 * 1. **边界判定**：4 邻域中与该格采样色的最大色差 ≥ snapDelta，说明该格
 *    骑在强边界上（两侧色块差异显著）。注意最大差邻居往往是「远侧」，
 *    它只用于判定，不作为候选。
 * 2. **候选**：所有比当前色暗（度量空间 L 更小）的非空邻格映射色中，
 *    取 ΔE(采样, 候选) 最小者（平局取更小色卡下标）。
 * 3. **保真度容差**：ΔE(采样, 候选) ≤ ΔE(采样, 当前) + snapTolerance 才改写。
 *    交界格的采样色是两侧的混合，与深侧色差常常更小，容差让它倒向深侧。
 *
 * 每次调用至多向深色侧推一步；管线上只调用一次。
 */
export function snapBoundaries(options: SnapOptions): Int16Array {
  const { width, height, cells, rgb, palette, metric, snapDelta, snapTolerance } = options;
  assertGridShape(width, height, cells.length, "cells");
  if (rgb.length !== cells.length * 3) {
    throw new RangeError(
      `outline: rgb.length must equal cells.length*3=${cells.length * 3}; got ${rgb.length}`,
    );
  }
  if (options.locked != null && options.locked.length !== cells.length) {
    throw new RangeError(
      `outline: locked.length must equal cells.length=${cells.length}; got ${options.locked.length}`,
    );
  }
  if (options.rimMask != null && options.rimMask.length !== cells.length) {
    throw new RangeError(
      `outline: rimMask.length must equal cells.length=${cells.length}; got ${options.rimMask.length}`,
    );
  }
  if (!Number.isFinite(snapDelta) || snapDelta < 0 || !Number.isFinite(snapTolerance) || snapTolerance < 0) {
    throw new RangeError("outline: snapDelta and snapTolerance must be non-negative finite numbers");
  }

  // 色卡点的明度只算一次；「更暗」按所选度量空间的 L 比较。
  const palettePoints = palette.map((color) => toPoint(hexToRgb(color.hex), metric));
  const result = new Int16Array(cells);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const current = result[index];
      if (current === undefined || current === EMPTY_CELL) continue;
      if (options.locked != null && options.locked[index] === 1) continue;
      if (options.rimMask != null && options.rimMask[index] === 1) continue;

      const sample = readSample(rgb, index);

      // 1. 边界判定：最大邻差 ≥ snapDelta 才处理（最大差邻居本身不用）。
      let maxNeighborDelta = 0;
      for (const [dx, dy] of NEIGHBORS_4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighborCellIndex = ny * width + nx;
        const neighborColor = result[neighborCellIndex];
        if (neighborColor === undefined || neighborColor === EMPTY_CELL) continue;
        const delta = colorDelta(sample, readSample(rgb, neighborCellIndex), metric);
        if (delta > maxNeighborDelta) maxNeighborDelta = delta;
      }
      if (maxNeighborDelta < snapDelta) continue;

      const currentPoint = palettePoints[current];
      if (currentPoint === undefined) continue;
      const deltaToCurrent = colorDelta(sample, paletteRgbAt(palette, current), metric);

      // 2. 候选：更暗且在容差内的邻格映射色，取离采样最近者。
      let bestCandidate = -1;
      let bestCandidateDelta = Number.POSITIVE_INFINITY;
      for (const [dx, dy] of NEIGHBORS_4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighborCellIndex = ny * width + nx;
        const candidate = result[neighborCellIndex];
        if (candidate === undefined || candidate === EMPTY_CELL || candidate === current) continue;
        const candidatePoint = palettePoints[candidate];
        if (candidatePoint === undefined) continue;
        if (candidatePoint.L >= currentPoint.L) continue; // 只加深
        const deltaToCandidate = colorDelta(sample, paletteRgbAt(palette, candidate), metric);
        if (deltaToCandidate > deltaToCurrent + snapTolerance) continue; // 保真度预算
        // 严格 <：平局保留先扫描到的（方向顺序固定，左→右→上→下）。
        if (deltaToCandidate < bestCandidateDelta) {
          bestCandidateDelta = deltaToCandidate;
          bestCandidate = candidate;
        }
      }
      if (bestCandidate >= 0) {
        result[index] = bestCandidate;
      }
    }
  }
  return result;
}
