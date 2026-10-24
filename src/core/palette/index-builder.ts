/**
 * 色卡索引：构建时一次性完成 hex → Lab / Oklab 的转换与校验，
 * 之后每次 nearest() 只做“查询色一次转换 + 距离扫描”。
 *
 * 复杂度（本文件的两个公开入口）：
 * - buildPaletteIndex / indexPalette：O(n) 次转换，n 为色卡颜色数。
 * - nearest：O(k) 次色差计算，k = candidates 长度（未给候选时 k = n）。
 *
 * 为什么不做 KD-tree：
 * 1) 规格规模上限是 500 色；单次查询最多 500 次色差计算，常数很小，
 *    在抖动 / 局部优化的调用频率下仍是可接受的线性扫描。
 * 2) CIEDE2000 不是严格度量，已知存在违反三角不等式的情形，
 *    任何依赖“下界剪枝”的空间树都可能返回错误最近邻。
 * 3) candidates 子集查询会让树的维护成本高于直接扫描。
 * 因此这里刻意保持线性扫描，把复杂度写在注释里而不是引入过度设计。
 *
 * 确定性：转换顺序固定为色卡下标升序；平局规则固定为“更小 index 胜”；
 * 不使用 Map/Set 的遍历顺序，不持有跨调用可变状态（缓存本身只读）。
 */

import { deltaE2000, deltaEOklab, hexToRgb, rgbToLab, rgbToOklab } from "../color";
import type { ColorMetricName, RGB } from "../color";
import { PaletteError, assertColorMetricName, assertSampleColor } from "./types";
import type { BeadColor, PaletteIndex, PaletteMatch } from "./types";

/** 调色板点：Lab 与 Oklab 结构同形，统一用只读三元组承载。 */
export interface SpacePoint {
  readonly L: number;
  readonly a: number;
  readonly b: number;
}

/**
 * 预处理后的色卡空间。indexPalette 与 buildPaletteIndex 共用，
 * subset.ts 也通过它复用同一份校验 + 转换结果。
 */
export interface PaletteSpace {
  readonly metric: ColorMetricName;
  readonly size: number;
  readonly points: readonly SpacePoint[];
  toPoint(rgb: RGB): SpacePoint;
  distance(first: SpacePoint, second: SpacePoint): number;
}

/** 尚未找到任何候选时的哨兵。正常路径不会返回它。 */
const NO_MATCH_INDEX = -1;

/** 初始最优距离；任何有限距离都会替换它。 */
const INITIAL_BEST_DISTANCE = Number.POSITIVE_INFINITY;

/**
 * 读取已缓存的点。
 * 数组由构建函数按 0..size-1 稠密填充；此守卫只防御内部编程错误，
 * 不参与正常路径，也不改变任何结果。
 */
export function readSpacePoint(points: readonly SpacePoint[], index: number): SpacePoint {
  const point = points[index];
  if (point === undefined) {
    throw new RangeError(`internal: missing palette point at index ${index}`);
  }
  return point;
}

/**
 * 是否应把 candidate 设为新的最优。
 *
 * 规则写死：
 * - 距离严格更小 → 胜；
 * - 距离**完全相等**（`===`，不接受 epsilon）→ index 更小者胜。
 *
 * 不使用 epsilon 的原因：比较容差会让“谁更小”依赖容差取值，
 * 平局用例将无法给出唯一答案；这里要求的是确定性的字节级相等。
 */
function isBetterCandidate(
  distance: number,
  index: number,
  bestDistance: number,
  bestIndex: number,
): boolean {
  if (distance < bestDistance) {
    return true;
  }
  return distance === bestDistance && (bestIndex === NO_MATCH_INDEX || index < bestIndex);
}

/**
 * 校验色卡并转换到目标色彩空间。
 *
 * 校验顺序（VECTORS.md §0 同步记录，测试依赖该顺序）：
 * 1. metric；
 * 2. palette 必须是数组且非空；
 * 3. 逐条按下标升序校验字段类型、code 唯一性、hex 可解析性；
 *    任一条失败立即抛错，错误消息包含该条目的下标与 code。
 *
 * 重复 code 用 Map 做**成员判断**，从不遍历它；输出只依赖入参下标顺序。
 */
export function indexPalette(palette: readonly BeadColor[], metric: ColorMetricName): PaletteSpace {
  assertColorMetricName(metric);

  if (!Array.isArray(palette)) {
    throw new PaletteError(
      "INVALID_PALETTE_ENTRY",
      `palette must be an array of BeadColor; received ${String(palette)}`,
    );
  }
  if (palette.length === 0) {
    throw new PaletteError("EMPTY_PALETTE", "palette must contain at least one color");
  }

  const toPoint = (rgb: RGB): SpacePoint =>
    metric === "ciede2000" ? rgbToLab(rgb) : rgbToOklab(rgb);
  const distance = (first: SpacePoint, second: SpacePoint): number =>
    metric === "ciede2000" ? deltaE2000(first, second) : deltaEOklab(first, second);

  const points: SpacePoint[] = [];
  const firstIndexByCode = new Map<string, number>();

  for (let index = 0; index < palette.length; index += 1) {
    const rawEntry: unknown = palette[index];
    if (rawEntry === undefined || rawEntry === null || typeof rawEntry !== "object") {
      throw new PaletteError(
        "INVALID_PALETTE_ENTRY",
        `palette[${index}] must be an object; received ${String(rawEntry)}`,
      );
    }

    const entry = rawEntry as Record<string, unknown>;
    const code = entry["code"];
    const name = entry["name"];
    const hex = entry["hex"];
    const manufacturer = entry["manufacturer"];
    const series = entry["series"];

    if (typeof code !== "string") {
      throw new PaletteError(
        "INVALID_PALETTE_ENTRY",
        `palette[${index}].code must be a string; received ${String(code)}`,
      );
    }
    if (typeof name !== "string") {
      throw new PaletteError(
        "INVALID_PALETTE_ENTRY",
        `palette[${index}] (code "${code}").name must be a string; received ${String(name)}`,
      );
    }
    if (typeof hex !== "string") {
      throw new PaletteError(
        "INVALID_PALETTE_ENTRY",
        `palette[${index}] (code "${code}").hex must be a string; received ${String(hex)}`,
      );
    }
    if (typeof manufacturer !== "string") {
      throw new PaletteError(
        "INVALID_PALETTE_ENTRY",
        `palette[${index}] (code "${code}").manufacturer must be a string; received ${String(
          manufacturer,
        )}`,
      );
    }
    if (series !== undefined && typeof series !== "string") {
      throw new PaletteError(
        "INVALID_PALETTE_ENTRY",
        `palette[${index}] (code "${code}").series must be a string when present; received ${String(
          series,
        )}`,
      );
    }

    const previousIndex = firstIndexByCode.get(code);
    if (previousIndex !== undefined) {
      throw new PaletteError(
        "DUPLICATE_CODE",
        `duplicate palette code "${code}" at indices ${previousIndex} and ${index}`,
      );
    }
    firstIndexByCode.set(code, index);

    let rgb: RGB;
    try {
      rgb = hexToRgb(hex);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new PaletteError(
        "INVALID_HEX",
        `palette[${index}] (code "${code}") has invalid hex "${hex}"; ${reason}`,
      );
    }

    points.push(toPoint(rgb));
  }

  return {
    metric,
    size: points.length,
    points,
    toPoint,
    distance,
  };
}

/**
 * 构建只读色卡索引。
 *
 * 缓存策略：构建时把所有 hex 一次性转成 metric 指定的空间（Lab 或 Oklab）。
 * 之后 nearest() 不读取 hex，也不做任何跨调用写入。
 */
export function buildPaletteIndex(
  palette: readonly BeadColor[],
  metric: ColorMetricName,
): PaletteIndex {
  return new BeadPaletteIndex(indexPalette(palette, metric));
}

/**
 * PaletteIndex 的唯一实现。
 * 字段全部 readonly；除构造外无任何写入，因此可被多个调用方共享。
 */
class BeadPaletteIndex implements PaletteIndex {
  readonly size: number;

  private readonly space: PaletteSpace;

  constructor(space: PaletteSpace) {
    this.space = space;
    this.size = space.size;
  }

  /**
   * 在 candidates 限定范围内找最近色卡色。
   *
   * 平局规则（写死）：distance 完全相等时取更小的色卡 index。
   * 实现同时覆盖两种调用顺序：
   * - candidates 未给出：按下标升序扫描，严格 `<` 已保证小 index 先到先得；
   * - candidates 给出且乱序：显式 `distance === bestDistance && index < bestIndex`
   *   仍会把胜者换成更小 index。
   *
   * 候选校验先于扫描整体完成：即使非法下标排在合法下标之后，也一定抛错，
   * 不会先返回一个“看起来有效”的结果。
   */
  nearest(color: RGB, candidates?: readonly number[]): PaletteMatch {
    assertSampleColor(color, "nearest(color)");
    const validatedCandidates = this.validateCandidates(candidates);
    const query = this.space.toPoint(color);

    let bestIndex = NO_MATCH_INDEX;
    let bestDistance = INITIAL_BEST_DISTANCE;

    if (validatedCandidates === null) {
      for (let index = 0; index < this.size; index += 1) {
        const distance = this.space.distance(query, readSpacePoint(this.space.points, index));
        if (isBetterCandidate(distance, index, bestDistance, bestIndex)) {
          bestIndex = index;
          bestDistance = distance;
        }
      }
    } else {
      for (const index of validatedCandidates) {
        const distance = this.space.distance(query, readSpacePoint(this.space.points, index));
        if (isBetterCandidate(distance, index, bestDistance, bestIndex)) {
          bestIndex = index;
          bestDistance = distance;
        }
      }
    }

    if (bestIndex === NO_MATCH_INDEX) {
      // size ≥ 1 且 candidates 非空，正常路径不可达。
      throw new PaletteError("INVALID_CANDIDATES", "no candidate palette index was provided");
    }

    return { index: bestIndex, distance: bestDistance };
  }

  /**
   * 返回 null 表示“未限制候选，扫描全表”。
   * 返回数组时保证每个元素都是 [0, size) 内的整数。
   */
  private validateCandidates(candidates: readonly number[] | undefined): readonly number[] | null {
    if (candidates === undefined) {
      return null;
    }
    if (!Array.isArray(candidates)) {
      throw new PaletteError(
        "INVALID_CANDIDATES",
        `candidates must be an array of palette indices; received ${String(candidates)}`,
      );
    }
    if (candidates.length === 0) {
      throw new PaletteError(
        "INVALID_CANDIDATES",
        "candidates must be non-empty when provided; an empty subset cannot produce a match",
      );
    }
    for (let position = 0; position < candidates.length; position += 1) {
      const index = candidates[position];
      if (index === undefined || !Number.isInteger(index) || index < 0 || index >= this.size) {
        throw new PaletteError(
          "INVALID_CANDIDATE_INDEX",
          `candidates[${position}] = ${String(index)} is not an integer in [0, ${this.size})`,
        );
      }
    }
    return candidates;
  }
}
