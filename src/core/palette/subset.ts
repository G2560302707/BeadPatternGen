/**
 * 最大颜色数约束：加权 k-medoids 子集选择。
 *
 * 规格红线：返回的每个 index 都必须是 palette 中真实存在的颜色。
 * 本文件从不计算样本均值、中心点或任何合成色；medoid 只能从色卡条目里选。
 *
 * 算法（完全确定，无随机数）：
 * 1. 样本按精确 RGB 折叠，weight = 出现次数。
 * 2. 先把每个唯一 RGB 样本映射到“全色卡最近邻”（平局取更小 index），
 *    该映射只算一次，之后不再随已选集合变化。这个最近色卡色称为样本的
 *    “对应色卡色”，也是覆盖统计的依据。
 * 3. 第一个 medoid：覆盖权重之和最大的色卡色（并列取更小 index），
 *    即所有样本的“对应色卡色”中 Σ weight 最大者。
 * 4. 之后每轮：对每个“对应色卡色尚未被选中”的样本计算
 *      score(i) = weight(i) · minDistance(i, 已选集合)
 *    取 score 最大的样本（精确平局时取其对应色卡色 index 更小者），
 *    把该样本的对应色卡色加入已选集合。若不存在这样的样本
 *    （所有对应色卡色都已被选中），则取下标最小的未选色卡色补齐，
 *    保证结果长度严格等于 min(maxColors, size)。
 * 5. 输出前按下标升序排序。
 *
 * 复杂度：
 * - O(u·n) 建立样本 → 全色卡最近邻映射（u = 唯一 RGB 数，n = 色卡色数）；
 * - O(k·u) 完成 k 轮打分，每轮 O(u) 打分 + O(u) 更新最近距离；
 * - 空间 O(u + n)。
 * n ≤ 500 时不需要 KD-tree；且 CIEDE2000 不满足严格三角不等式，
 * 树剪枝并不可靠（详见 index-builder.ts 的同一说明）。
 *
 * 确定性：
 * - 唯一样本先按 (r, g, b) 字典序全序排序，Map 插入顺序不会进入任何比较；
 * - 每轮按唯一样本下标升序扫描；精确平局按“对应色卡色 index 更小”裁决，
 *   不以“谁先被扫到”作为平局依据；
 * - 所有 argmax / argmin 都使用严格比较，平局落到更小 index。
 */

import type { ColorMetricName, RGB } from "../color";
import { indexPalette, readSpacePoint } from "./index-builder";
import type { PaletteSpace, SpacePoint } from "./index-builder";
import { PaletteError, assertSampleColor } from "./types";
import type { BeadColor } from "./types";

/** 尚未选中任何色卡色时的哨兵。 */
const NO_INDEX = -1;

/** 每轮打分的初始最优值；任何非负 score 都会替换它。 */
const INITIAL_BEST_SCORE = -1;

/** 第一轮覆盖统计的初始最优值；coverage 非负，任何候选都会替换。 */
const INITIAL_BEST_COVERAGE = -1;

/** 折叠后的唯一 RGB 样本及其出现次数。 */
interface WeightedSample {
  readonly rgb: RGB;
  readonly weight: number;
}

/**
 * (r, g, b) 字典序全序比较。
 * 输入已保证是 [0, 255] 内的有限数；不同三元组比较结果非 0，
 * 因此对唯一化后的样本来说这是一个严格全序，排序结果与入参顺序无关。
 */
function compareRgb(first: RGB, second: RGB): number {
  if (first.r !== second.r) {
    return first.r - second.r;
  }
  if (first.g !== second.g) {
    return first.g - second.g;
  }
  return first.b - second.b;
}

/** Map 键：三个数值用逗号连接；有限数的 toString 可精确区分不同数值。 */
function rgbKey(rgb: RGB): string {
  return `${rgb.r},${rgb.g},${rgb.b}`;
}

/** 读取稠密数组元素；只防御内部编程错误，不参与正常路径。 */
function readNumber(values: readonly number[], index: number, label: string): number {
  const value = values[index];
  if (value === undefined) {
    throw new RangeError(`internal: missing ${label}[${index}]`);
  }
  return value;
}

/** 校验 maxColors：必须是正整数。 */
function assertMaxColors(maxColors: number): void {
  if (typeof maxColors !== "number" || !Number.isInteger(maxColors) || maxColors <= 0) {
    throw new PaletteError(
      "INVALID_MAX_COLORS",
      `maxColors must be a positive integer; received ${String(maxColors)}`,
    );
  }
}

/**
 * 校验并折叠样本。
 * - samples 非数组或为空 → EMPTY_SAMPLES；
 * - 任一 RGB 非法 → INVALID_SAMPLE（消息含样本下标）；
 * - 相同 RGB 的出现次数累加为 weight。
 *
 * 返回值已按 (r, g, b) 升序排序，后续所有求和都依赖该固定顺序。
 */
function collectWeightedSamples(samples: readonly RGB[]): WeightedSample[] {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new PaletteError("EMPTY_SAMPLES", "samples must be a non-empty array of RGB values");
  }

  const uniqueByKey = new Map<string, { rgb: RGB; weight: number }>();

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (sample === undefined) {
      throw new PaletteError("INVALID_SAMPLE", `samples[${index}] is missing`);
    }
    assertSampleColor(sample, `samples[${index}]`);

    const key = rgbKey(sample);
    const existing = uniqueByKey.get(key);
    if (existing === undefined) {
      // 复制一份，避免调用方在返回后修改原对象影响内部状态。
      uniqueByKey.set(key, {
        rgb: { r: sample.r, g: sample.g, b: sample.b },
        weight: 1,
      });
    } else {
      existing.weight += 1;
    }
  }

  const unique = Array.from(uniqueByKey.values());
  // Map 的插入顺序在这里被排序完全覆盖；sort 的比较器是严格全序。
  unique.sort((first, second) => compareRgb(first.rgb, second.rgb));
  return unique;
}

/**
 * 在色卡空间中找 point 的最近邻，平局取更小 index。
 * 扫描顺序固定为 0..size-1，严格 `<` 保证平局不替换。
 */
function nearestPaletteIndex(space: PaletteSpace, point: SpacePoint): number {
  let bestIndex = 0;
  let bestDistance = space.distance(point, readSpacePoint(space.points, 0));

  for (let index = 1; index < space.size; index += 1) {
    const distance = space.distance(point, readSpacePoint(space.points, index));
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  }

  return bestIndex;
}

/**
 * 从真实色卡中选出至多 maxColors 个颜色，用于覆盖给定样本分布。
 *
 * 返回值：palette 下标的升序数组，长度严格等于 min(maxColors, palette.length)。
 * 结果中每个元素都是入参 palette 的有效下标，绝不含合成色。
 *
 * 校验顺序（VECTORS.md §0 同步记录）：
 * 1. maxColors（正整数）；
 * 2. metric 与 palette（由 indexPalette 校验：metric、非空、字段、hex、重复 code）；
 * 3. samples（非空数组、每个 RGB 合法）。
 *
 * 因此 maxColors 非法时会先报 INVALID_MAX_COLORS，即使 palette / samples 也不合法。
 */
export function selectPaletteSubset(
  samples: readonly RGB[],
  palette: readonly BeadColor[],
  maxColors: number,
  metric: ColorMetricName,
): number[] {
  assertMaxColors(maxColors);

  // 复用索引层的校验与转换；palette 为空会在这一步抛 EMPTY_PALETTE。
  const space = indexPalette(palette, metric);
  const paletteSize = space.size;

  const weightedSamples = collectWeightedSamples(samples);

  // 色卡数量不超过上限：全部返回，升序，不进入贪心。
  if (maxColors >= paletteSize) {
    const allIndices: number[] = [];
    for (let index = 0; index < paletteSize; index += 1) {
      allIndices.push(index);
    }
    return allIndices;
  }

  const sampleCount = weightedSamples.length;
  const weights: number[] = [];
  const samplePoints: SpacePoint[] = [];

  for (const sample of weightedSamples) {
    weights.push(sample.weight);
    samplePoints.push(space.toPoint(sample.rgb));
  }

  // assignment[i]：唯一样本 i 在全色卡中的最近色卡下标（静态映射）。
  // minDistances[i]：唯一样本 i 到当前已选集合的最小距离。
  const assignments: number[] = [];
  const minDistances: number[] = [];
  const coverage: number[] = new Array<number>(paletteSize).fill(0);

  for (let index = 0; index < sampleCount; index += 1) {
    const point = readSpacePoint(samplePoints, index);
    const nearestIndex = nearestPaletteIndex(space, point);
    assignments.push(nearestIndex);
    minDistances.push(space.distance(point, readSpacePoint(space.points, nearestIndex)));
    coverage[nearestIndex] =
      readNumber(coverage, nearestIndex, "coverage") + readNumber(weights, index, "weights");
  }

  // 第一轮：覆盖权重最大者；升序 + 严格 `>` ⇒ 平局取更小 index。
  let firstMedoid = 0;
  let bestCoverage = INITIAL_BEST_COVERAGE;
  for (let index = 0; index < paletteSize; index += 1) {
    const value = readNumber(coverage, index, "coverage");
    if (value > bestCoverage) {
      bestCoverage = value;
      firstMedoid = index;
    }
  }

  const selected: number[] = [firstMedoid];
  const isSelected: boolean[] = new Array<boolean>(paletteSize).fill(false);
  isSelected[firstMedoid] = true;

  // 把“到已选集合的最小距离”初始化为到第一个 medoid 的距离。
  const firstMedoidPoint = readSpacePoint(space.points, firstMedoid);
  for (let index = 0; index < sampleCount; index += 1) {
    minDistances[index] = space.distance(readSpacePoint(samplePoints, index), firstMedoidPoint);
  }

  // 后续轮次：取 weight × minDistance 最大的样本，把它的对应色卡色加入集合。
  while (selected.length < maxColors) {
    let candidateIndex = NO_INDEX;
    let bestScore = INITIAL_BEST_SCORE;

    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      const assignedIndex = readNumber(assignments, sampleIndex, "assignments");
      if (isSelected[assignedIndex] === true) {
        // 该样本的对应色卡色已在集合中，重复加入不会增加覆盖。
        continue;
      }

      const score =
        readNumber(weights, sampleIndex, "weights") *
        readNumber(minDistances, sampleIndex, "minDistances");

      // 严格 `>`，平局再比对应色卡色 index：
      // 结果与样本入参顺序、唯一化后的扫描顺序都无关。
      if (
        score > bestScore ||
        (score === bestScore && (candidateIndex === NO_INDEX || assignedIndex < candidateIndex))
      ) {
        bestScore = score;
        candidateIndex = assignedIndex;
      }
    }

    if (candidateIndex === NO_INDEX) {
      // 所有样本的对应色卡色都已被选中：用最小未选 index 补齐。
      for (let paletteIndex = 0; paletteIndex < paletteSize; paletteIndex += 1) {
        if (isSelected[paletteIndex] === false) {
          candidateIndex = paletteIndex;
          break;
        }
      }
    }

    if (candidateIndex === NO_INDEX) {
      // selected.length < maxColors < paletteSize ⇒ 至少还有一个未选色，正常不可达。
      throw new RangeError(
        "internal: selectPaletteSubset could not find an unselected palette color",
      );
    }

    selected.push(candidateIndex);
    isSelected[candidateIndex] = true;

    // 加入新 medoid 后更新每个样本到已选集合的最小距离。
    const newMedoidPoint = readSpacePoint(space.points, candidateIndex);
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      const distance = space.distance(readSpacePoint(samplePoints, sampleIndex), newMedoidPoint);
      if (distance < readNumber(minDistances, sampleIndex, "minDistances")) {
        minDistances[sampleIndex] = distance;
      }
    }
  }

  // 返回升序下标。数值比较器对互不相同的整数是严格全序，不依赖原选择顺序。
  selected.sort((first, second) => first - second);
  return selected;
}
