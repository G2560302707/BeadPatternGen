/**
 * S09 · 局部结构优化的目标函数与确定性邻域搜索。
 *
 * 目标函数（逐字对应拆解文档，权重固定为 1 的色差项在最前）：
 *
 *   score(i, j) = ΔE(cell_i, candidate_j)
 *               + isolatedPenalty   · I(i, j)
 *               + edgeProtectWeight · edgeStrength[i] · R(i, j)
 *
 * 其中：
 * - `I(i, j) = 1` 当且仅当把颜色 j 放在格子 i 后，i 的 4-邻域里没有任何同色格；
 * - `R(i, j) = 1` 当且仅当 j 与格子当前色不同（即这是一次“改色”）；
 * - `edgeStrength[i] ∈ [0, 1]` 由调用方提供，把二值改色惩罚缩放成连续强度。
 *
 * 关于 ΔE(cell_i, candidate_j)：
 * `RefineOptions` 只提供 `perCellDelta[i] = ΔE(原始采样色, 当前色)`，没有提供
 * 原始采样色本身，因此**无法精确**计算 ΔE(原始采样色, 候选色)。本文件采用
 * 三角不等式给出的保守上界：
 *
 *   ΔE(原始, 候选) ≤ ΔE(原始, 当前) + ΔE(当前, 候选)
 *                  = perCellDelta[i] + colorDelta(current, candidate)
 *
 * - 候选 = 当前色时取等号右侧的第一项（精确值）；
 * - 候选 ≠ 当前色时取上界，**绝不低估**改色带来的保真度代价；
 * - 上界中的 `perCellDelta[i]` 对所有候选相同，因此在比较候选时抵消，
 *   不会人为地阻止孤立豆修复（即使调用方把 perCellDelta 全填 0 也照常工作）。
 *
 * 候选集（拆解文档要求）：
 *   { 当前色 } ∪ { 到当前色 ΔE 最小的前 N 个色卡色 }，N = neighborCandidateCount。
 * `PaletteIndex` 只暴露单点最近邻，无法枚举前 N；候选表由同一份 palette + metric
 * 一次性算出。`index` 本身用于交叉校验 `index.size === palette.length`，确保调用方
 * 传入的索引与 palette 对齐。
 *
 * 确定性契约：
 * 1. 扫描顺序固定为 row-major（y 升序，x 升序）；
 * 2. 4-邻域检查顺序固定为 左 → 右 → 上 → 下；
 * 3. 候选排序键固定为 (距离升序, palette 下标升序)；比较器是全序；
 * 4. 只有 `score < bestScore` 才接受候选，平局一律保留当前色（避免来回抖动）；
 * 5. 浮点求和顺序固定为 色差 → 孤立惩罚 → 边缘惩罚（见 scoreCandidate）；
 * 6. 不使用随机数、时间、Map/Set 遍历顺序或任何跨调用可变状态。
 *
 * 收敛 / 幂等（硬要求）：
 * - 非孤立格子的当前得分是 `perCellDelta`，任何候选都要再加上非负的色差与
 *   边缘惩罚，因此**非孤立格子永不改色**；
 * - 孤立格子若接受候选，该候选必须让 4-邻域出现同色格（否则惩罚项更大，
 *   不可能严格优于当前得分），于是改色后该格子变为非孤立；
 * - 改色格原本孤立 ⇒ 它没有同色邻格 ⇒ 它的离开不会让任何邻格失去同色邻居，
 *   因此孤立格总数在每次改色后严格减少。
 *
 * 所以改色次数 ≤ 初始孤立格数 ≤ cellCount。函数先执行 `localRefinePasses` 轮
 * 常规扫描；若最后一轮仍有变化，再追加稳定化扫描直到某一轮零变化。稳定化轮数
 * 有 `cellCount + 1` 的数学上界，因此返回值一定是「再调用一次也不会变」的不动点。
 * `localRefinePasses = 0` 时直接返回输入副本，完全不做优化。
 */

import { deltaE2000, deltaEOklab, hexToRgb, rgbToLab, rgbToOklab } from "../color";
import type { ColorMetricName, RGB } from "../color";
import type { BeadColor, PaletteIndex } from "../palette";
import type { ModeProfile, RefineOptions } from "./types";

/** 空格索引。来源：规格 5.1（`-1 = 空格`）。 */
const EMPTY_CELL = -1;

/** Int16Array 能表示的最大色卡下标。超过它就无法把下标写回 cells。 */
const MAX_PALETTE_INDEX = 32767;

/**
 * 4-邻域偏移，顺序固定为 左 → 右 → 上 → 下。
 * 这个顺序只影响短路的先后，不影响布尔结果；写死是为了让任何未来的
 * “带权邻域”扩展有可复现的基准顺序。
 */
const NEIGHBOR_OFFSETS: readonly (readonly [number, number])[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

/** edgeStrength 的合法闭区间。来源：拆解文档 S09（每格边缘强度 0–1）。 */
const EDGE_STRENGTH_MIN = 0;
const EDGE_STRENGTH_MAX = 1;

/** Lab 与 Oklab 结构同形，用同一个只读三元组承载。 */
interface SpacePoint {
  readonly L: number;
  readonly a: number;
  readonly b: number;
}

/** 一个候选色卡条目。 */
interface CandidateEntry {
  /** palette 下标。 */
  readonly index: number;
  /** 与“当前色”的 ΔE，不是与原始采样色的 ΔE。 */
  readonly distance: number;
}

/** 按当前色下标索引的候选表。 */
type CandidateTable = readonly (readonly CandidateEntry[])[];

/** 候选色差项的参数，供 `scoreCandidate` 独立测试。 */
export interface CandidateScoreTerms {
  /**
   * ΔE(cell, candidate)。
   * - 当前色：调用方传入 `perCellDelta`（精确值）；
   * - 候选色：调用方传入 `perCellDelta + ΔE(当前色, 候选色)`（保守上界）。
   */
  colorDelta: number;
  /** 把该候选放到格子上后，4-邻域内是否没有同色格。 */
  causesIsolation: boolean;
  /** 该候选是否与当前色不同（即是否是一次改色）。 */
  edgeRecolor: boolean;
  /** 该格的边缘强度 0–1。`edgeRecolor = false` 时本项不参与。 */
  edgeStrength: number;
  /** 孤立点惩罚权重。 */
  isolatedPenalty: number;
  /** 边缘保护权重。 */
  edgeProtectWeight: number;
}

/**
 * 目标函数本体。独立导出，便于不依赖格子数组直接测试公式。
 *
 * 求和顺序固定为：色差 → 孤立惩罚 → 边缘惩罚（左结合）。
 * 改顺序会改变浮点末位；回归测试依赖该顺序。
 */
export function scoreCandidate(terms: CandidateScoreTerms): number {
  const isolationTerm = terms.causesIsolation ? terms.isolatedPenalty : 0;
  const edgeTerm = terms.edgeRecolor ? terms.edgeProtectWeight * terms.edgeStrength : 0;

  return terms.colorDelta + isolationTerm + edgeTerm;
}

/** 断言正整数。 */
function assertPositiveInteger(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive integer; received ${String(value)}`);
  }
}

/** 断言有限数。 */
function assertFiniteNumber(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RangeError(`${label} must be a finite number; received ${String(value)}`);
  }
}

/** 断言有限且非负。 */
function assertNonNegativeFinite(value: number, label: string): void {
  assertFiniteNumber(value, label);
  if (value < 0) {
    throw new RangeError(`${label} must be non-negative; received ${value}`);
  }
}

/** 运行时校验 metric；类型系统之外的 JS / 反序列化调用方也要挡住。 */
function assertMetric(metric: ColorMetricName): void {
  if (metric !== "ciede2000" && metric !== "oklab") {
    throw new RangeError(`metric must be "ciede2000" or "oklab"; received ${String(metric)}`);
  }
}

/**
 * 校验 profile 的运行时取值。
 * 所有颜色差类参数必须有限且非负；轮数与候选数必须是整数。
 * 直接抛错而不是静默夹取，与 S04 / S05 / S07 的输入域策略一致。
 */
function assertProfile(profile: ModeProfile): void {
  if (profile === null || typeof profile !== "object") {
    throw new RangeError(`profile must be an object; received ${String(profile)}`);
  }

  if (profile.defaultDithering !== "none" && profile.defaultDithering !== "floyd-steinberg") {
    throw new RangeError(
      `profile.defaultDithering must be "none" or "floyd-steinberg"; received ${String(
        profile.defaultDithering,
      )}`,
    );
  }
  if (typeof profile.allowUserDithering !== "boolean") {
    throw new RangeError(
      `profile.allowUserDithering must be a boolean; received ${String(
        profile.allowUserDithering,
      )}`,
    );
  }

  assertNonNegativeFinite(profile.edgeProtectWeight, "profile.edgeProtectWeight");
  assertNonNegativeFinite(profile.isolatedPenalty, "profile.isolatedPenalty");
  assertNonNegativeFinite(profile.colorMergeThreshold, "profile.colorMergeThreshold");

  if (!Number.isInteger(profile.localRefinePasses) || profile.localRefinePasses < 0) {
    throw new RangeError(
      `profile.localRefinePasses must be a non-negative integer; received ${String(
        profile.localRefinePasses,
      )}`,
    );
  }
  if (!Number.isInteger(profile.neighborCandidateCount) || profile.neighborCandidateCount < 1) {
    throw new RangeError(
      `profile.neighborCandidateCount must be a positive integer; received ${String(
        profile.neighborCandidateCount,
      )}`,
    );
  }
}

/** 读取调色板条目并做最基本的对象检查。 */
function readPaletteEntry(palette: readonly BeadColor[], index: number): BeadColor {
  const entry: unknown = palette[index];
  if (entry === undefined || entry === null || typeof entry !== "object") {
    throw new RangeError(`palette[${index}] must be a BeadColor object; received ${String(entry)}`);
  }
  return entry as BeadColor;
}

/**
 * 校验尺寸、数组、色卡与逐格数据。
 *
 * 校验顺序写死（测试依赖）：
 * 1. options 对象；
 * 2. width / height；
 * 3. cells / perCellDelta / edgeStrength 的类型与长度；
 * 4. metric；
 * 5. profile；
 * 6. palette 非空、index 形状、index.size 与 palette 对齐；
 * 7. 逐格 cells 下标、perCellDelta、edgeStrength 的取值域。
 */
function assertOptions(options: RefineOptions): number {
  if (options === null || typeof options !== "object") {
    throw new RangeError(`options must be an object; received ${String(options)}`);
  }

  assertPositiveInteger(options.width, "width");
  assertPositiveInteger(options.height, "height");

  const cellCount = options.width * options.height;
  if (!Number.isSafeInteger(cellCount)) {
    throw new RangeError(
      `width*height must be a safe integer; received ${options.width}*${options.height}`,
    );
  }

  if (!(options.cells instanceof Int16Array)) {
    throw new RangeError("cells must be an Int16Array");
  }
  if (options.cells.length !== cellCount) {
    throw new RangeError(
      `cells.length must equal width*height=${cellCount}; received ${options.cells.length}`,
    );
  }

  if (!(options.perCellDelta instanceof Float32Array)) {
    throw new RangeError("perCellDelta must be a Float32Array");
  }
  if (options.perCellDelta.length !== cellCount) {
    throw new RangeError(
      `perCellDelta.length must equal width*height=${cellCount}; received ${options.perCellDelta.length}`,
    );
  }

  if (!(options.edgeStrength instanceof Float32Array)) {
    throw new RangeError("edgeStrength must be a Float32Array");
  }
  if (options.edgeStrength.length !== cellCount) {
    throw new RangeError(
      `edgeStrength.length must equal width*height=${cellCount}; received ${options.edgeStrength.length}`,
    );
  }

  if (options.locked != null && !(options.locked instanceof Uint8Array)) {
    throw new RangeError("locked must be a Uint8Array when provided");
  }
  if (options.locked != null && options.locked.length !== cellCount) {
    throw new RangeError(
      `locked.length must equal width*height=${cellCount}; received ${options.locked.length}`,
    );
  }

  assertMetric(options.metric);
  assertProfile(options.profile);

  if (!Array.isArray(options.palette) || options.palette.length === 0) {
    throw new RangeError("palette must be a non-empty array of BeadColor");
  }
  const paletteSize = options.palette.length;
  if (paletteSize > MAX_PALETTE_INDEX) {
    throw new RangeError(
      `palette.length must be <= ${MAX_PALETTE_INDEX} so indices fit in Int16Array; ` +
        `received ${paletteSize}`,
    );
  }

  const index: PaletteIndex = options.index;
  if (
    index === null ||
    typeof index !== "object" ||
    typeof index.size !== "number" ||
    typeof index.nearest !== "function"
  ) {
    throw new RangeError("index must be a PaletteIndex");
  }
  if (index.size !== paletteSize) {
    throw new RangeError(
      `index.size (${index.size}) must equal palette.length (${paletteSize}); ` +
        "the palette index must be built from this exact palette",
    );
  }

  for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
    const cell = options.cells[cellIndex];
    if (cell === undefined || !Number.isInteger(cell)) {
      throw new RangeError(`cells[${cellIndex}] must be an integer; received ${String(cell)}`);
    }
    if (cell < EMPTY_CELL || cell >= paletteSize) {
      throw new RangeError(
        `cells[${cellIndex}] must be -1 or a palette index in [0, ${paletteSize}); received ${cell}`,
      );
    }

    const delta = options.perCellDelta[cellIndex];
    if (delta === undefined || !Number.isFinite(delta)) {
      throw new RangeError(
        `perCellDelta[${cellIndex}] must be a finite number; received ${String(delta)}`,
      );
    }
    // 空格没有采样色，允许调用方用 0 / -1 等哨兵值；非空格必须是真实 ΔE。
    if (cell !== EMPTY_CELL && delta < 0) {
      throw new RangeError(
        `perCellDelta[${cellIndex}] must be non-negative for a non-empty cell; received ${delta}`,
      );
    }

    const edge = options.edgeStrength[cellIndex];
    if (edge === undefined || !Number.isFinite(edge)) {
      throw new RangeError(
        `edgeStrength[${cellIndex}] must be a finite number; received ${String(edge)}`,
      );
    }
    if (edge < EDGE_STRENGTH_MIN || edge > EDGE_STRENGTH_MAX) {
      throw new RangeError(
        `edgeStrength[${cellIndex}] must be within [${EDGE_STRENGTH_MIN}, ${EDGE_STRENGTH_MAX}]; ` +
          `received ${edge}`,
      );
    }
  }

  return cellCount;
}

/**
 * 把 palette 的 hex 一次性转换成目标色彩空间的点。
 *
 * 这一步同时完成 hex 合法性校验；转换顺序固定为 palette 下标升序。
 * `distance` 的取值由 metric 决定，调用方必须保证与构建 PaletteIndex 时一致
 * （PaletteIndex 接口不暴露自身 metric，无法在运行时反查）。
 */
function parsePalette(options: RefineOptions): {
  readonly points: readonly SpacePoint[];
  readonly distance: (first: SpacePoint, second: SpacePoint) => number;
} {
  const points: SpacePoint[] = [];

  for (let position = 0; position < options.palette.length; position += 1) {
    const entry = readPaletteEntry(options.palette, position);
    if (typeof entry.hex !== "string") {
      throw new RangeError(
        `palette[${position}].hex must be a string; received ${String(entry.hex)}`,
      );
    }

    let rgb: RGB;
    try {
      rgb = hexToRgb(entry.hex);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new RangeError(
        `palette[${position}] (code "${String(entry.code)}") has invalid hex "${entry.hex}"; ${reason}`,
        { cause: error },
      );
    }

    points.push(options.metric === "ciede2000" ? rgbToLab(rgb) : rgbToOklab(rgb));
  }

  return {
    points,
    distance: (first: SpacePoint, second: SpacePoint): number =>
      options.metric === "ciede2000" ? deltaE2000(first, second) : deltaEOklab(first, second),
  };
}

/** 候选排序：距离升序，平局按下标升序。下标唯一 ⇒ 全序，结果与引擎排序稳定性无关。 */
function compareCandidates(left: CandidateEntry, right: CandidateEntry): number {
  if (left.distance < right.distance) {
    return -1;
  }
  if (left.distance > right.distance) {
    return 1;
  }
  return left.index - right.index;
}

/**
 * 为每个 palette 下标预计算候选集。
 *
 * 复杂度 O(n² log n)，n = palette.length。规格上限 500 色，一次性计算可接受；
 * 该表只属于本次调用，函数返回后立即丢弃，不是跨调用缓存。
 *
 * 候选集严格为「当前色 + 到当前色最近的 N 个色卡色」。若有多个色卡色的 hex /
 * 颜色完全相同（距离 0），当前色可能不在前 N 名里，因此显式补回当前色，
 * 最终长度可能是 N + 1。这正是拆解文档中“当前色 + 最近邻前 N 个”的并集语义。
 */
function buildCandidateTable(
  points: readonly SpacePoint[],
  distance: (first: SpacePoint, second: SpacePoint) => number,
  requestedCount: number,
): CandidateTable {
  const size = points.length;
  const count = Math.min(requestedCount, size);
  const table: (readonly CandidateEntry[])[] = [];

  for (let current = 0; current < size; current += 1) {
    const currentPoint = points[current];
    if (currentPoint === undefined) {
      throw new RangeError(`internal: missing palette point at index ${current}`);
    }

    const entries: CandidateEntry[] = [];
    for (let other = 0; other < size; other += 1) {
      const otherPoint = points[other];
      if (otherPoint === undefined) {
        throw new RangeError(`internal: missing palette point at index ${other}`);
      }
      const candidateDistance = distance(currentPoint, otherPoint);
      if (!Number.isFinite(candidateDistance)) {
        throw new RangeError(
          `internal: non-finite distance between palette colors ${current} and ${other}`,
        );
      }
      entries.push({ index: other, distance: candidateDistance });
    }

    entries.sort(compareCandidates);
    const chosen = entries.slice(0, count);

    let hasCurrent = false;
    for (const entry of chosen) {
      if (entry.index === current) {
        hasCurrent = true;
        break;
      }
    }
    if (!hasCurrent) {
      // 相同颜色的距离为 0；当前色到自身严格为 0（CIEDE2000 / Oklab 在相同点都返回 0）。
      chosen.push({ index: current, distance: 0 });
      chosen.sort(compareCandidates);
    }

    table.push(chosen);
  }

  return table;
}

/**
 * 判断把 `color` 放在 (x, y) 后，该格在 4-邻域内是否没有同色格。
 * 顺序固定为 左 → 右 → 上 → 下；空格 (-1) 永远不会等于任何合法候选色。
 */
function isIsolated(
  cells: Int16Array,
  width: number,
  height: number,
  x: number,
  y: number,
  color: number,
): boolean {
  for (const offset of NEIGHBOR_OFFSETS) {
    const neighborX = x + offset[0];
    const neighborY = y + offset[1];
    if (neighborX < 0 || neighborX >= width || neighborY < 0 || neighborY >= height) {
      continue;
    }
    if (cells[neighborY * width + neighborX] === color) {
      return false;
    }
  }
  return true;
}

/** 一轮扫描所需的只读上下文。 */
interface PassContext {
  readonly width: number;
  readonly height: number;
  readonly candidates: CandidateTable;
  readonly perCellDelta: Float32Array;
  readonly edgeStrength: Float32Array;
  readonly mergeThreshold: number;
  readonly isolatedPenalty: number;
  readonly edgeProtectWeight: number;
  /** 特征锁掩码（S11，可空）：锁定格不参与孤立豆修复改色。 */
  readonly locked: Uint8Array | null;
}

/**
 * row-major 扫描一轮，就地修改 `cells`，返回本轮是否有格子改色。
 *
 * 关键剪枝：当前格若不是孤立格，则当前得分 = perCellDelta，而任何候选的得分
 * 都 ≥ perCellDelta + 0（色差非负、孤立惩罚非负、边缘惩罚非负），严格更小不可能，
 * 因此直接跳过。这既省时间，也是“非孤立格永不改色”收敛证明的实现依据。
 *
 * 注意：`isIsolated` 只看邻格，不看本格当前值，所以就地更新不会让判定产生歧义；
 * 本轮中较早改色的邻格会立即参与后续格子的判定，这是确定性 row-major 扫描的一部分。
 */
function runPass(cells: Int16Array, context: PassContext): boolean {
  let changed = false;

  for (let y = 0; y < context.height; y += 1) {
    for (let x = 0; x < context.width; x += 1) {
      const cellIndex = y * context.width + x;
      const current = cells[cellIndex];
      if (current === undefined) {
        throw new RangeError(`internal: missing cell at index ${cellIndex}`);
      }
      if (current === EMPTY_CELL) {
        continue;
      }
      // S11 特征锁：有意细节（眼高光 / 瞳孔 / 小图标）不做孤立豆修复。
      if (context.locked != null && context.locked[cellIndex] === 1) {
        continue;
      }

      const isolatedNow = isIsolated(cells, context.width, context.height, x, y, current);
      if (!isolatedNow) {
        continue;
      }
      // 孤立惩罚为 0 时，任何候选都不可能在“色差 ≥ 0、边缘惩罚 ≥ 0”的情况下
      // 严格优于当前得分；直接跳过，保证全零权重时严格等于输入。
      if (context.isolatedPenalty <= 0) {
        continue;
      }

      const currentDelta = context.perCellDelta[cellIndex] ?? 0;
      const currentEdge = context.edgeStrength[cellIndex] ?? 0;

      let bestColor = current;
      let bestScore = scoreCandidate({
        colorDelta: currentDelta,
        causesIsolation: true,
        edgeRecolor: false,
        edgeStrength: currentEdge,
        isolatedPenalty: context.isolatedPenalty,
        edgeProtectWeight: context.edgeProtectWeight,
      });

      const candidates = context.candidates[current];
      if (candidates === undefined) {
        throw new RangeError(`internal: missing candidate list for palette index ${current}`);
      }

      for (const candidate of candidates) {
        if (candidate.index === current) {
          continue;
        }
        // “相邻色视为可合并”的硬门槛；注释写的是“小于”，因此用严格 <。
        if (!(candidate.distance < context.mergeThreshold)) {
          continue;
        }

        const isolatedAfter = isIsolated(
          cells,
          context.width,
          context.height,
          x,
          y,
          candidate.index,
        );

        // 保守上界：ΔE(原始, 候选) = ΔE(原始, 当前) + ΔE(当前, 候选)。
        // 求和顺序写死为 perCellDelta → candidate.distance。
        const candidateScore = scoreCandidate({
          colorDelta: currentDelta + candidate.distance,
          causesIsolation: isolatedAfter,
          edgeRecolor: true,
          edgeStrength: currentEdge,
          isolatedPenalty: context.isolatedPenalty,
          edgeProtectWeight: context.edgeProtectWeight,
        });

        // 严格小于才接受；平局保留当前色，避免同一对颜色来回切换。
        if (candidateScore < bestScore) {
          bestScore = candidateScore;
          bestColor = candidate.index;
        }
      }

      if (bestColor !== current) {
        cells[cellIndex] = bestColor;
        changed = true;
      }
    }
  }

  return changed;
}

/**
 * 局部优化主入口。返回值是新分配的 `Int16Array`，入参 `cells` 不会被修改。
 *
 * 执行策略：
 * 1. `localRefinePasses === 0`：只做输入校验，返回副本；
 * 2. 先执行 `localRefinePasses` 轮常规 row-major 扫描；任一轮零变化即提前返回；
 * 3. 若常规轮结束时仍有变化，追加稳定化扫描直到零变化。稳定化轮数有
 *    `cellCount + 1` 的数学上界（每次改色都严格减少孤立格数），因此返回值
 *    必定是不动点：第二次调用以它为输入时，第一轮就会零变化。
 *
 * 第 3 步是为了同时满足拆解文档的两条硬要求：“扫描 localRefinePasses 轮”
 * 与“连续两次调用结果相同”。`localRefinePasses ≥ 1` 时最终结果是不动点，
 * 调大它只影响至少扫描多少轮，不影响最终画面；详见 PARAMS.md。
 */
export function refineLocally(options: RefineOptions): Int16Array {
  const cellCount = assertOptions(options);

  // 先校验 palette 的 hex，即使 passes = 0 也不放过坏色卡。
  const space = parsePalette(options);

  const result = new Int16Array(options.cells);
  const passes = options.profile.localRefinePasses;
  if (passes === 0) {
    return result;
  }

  const candidateTable = buildCandidateTable(
    space.points,
    space.distance,
    options.profile.neighborCandidateCount,
  );

  const context: PassContext = {
    width: options.width,
    height: options.height,
    candidates: candidateTable,
    perCellDelta: options.perCellDelta,
    edgeStrength: options.edgeStrength,
    mergeThreshold: options.profile.colorMergeThreshold,
    isolatedPenalty: options.profile.isolatedPenalty,
    edgeProtectWeight: options.profile.edgeProtectWeight,
    locked: options.locked ?? null,
  };

  for (let pass = 0; pass < passes; pass += 1) {
    if (!runPass(result, context)) {
      return result;
    }
  }

  // 稳定化：每次改色让孤立格数量严格减 1，因此最多 cellCount 个“有变化”的轮。
  // 多跑一轮用于观察“零变化”，故上界取 cellCount + 1。
  const stabilizationLimit = cellCount + 1;
  for (let pass = 0; pass < stabilizationLimit; pass += 1) {
    if (!runPass(result, context)) {
      return result;
    }
  }

  // 按上面的单调性证明，正常路径不可达；保留守卫以暴露实现错误。
  throw new RangeError("internal: refineLocally did not converge within its stabilization bound");
}
