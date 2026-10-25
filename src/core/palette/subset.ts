/**
 * 最大颜色数约束：加权 k-means 聚类 → 真实色卡映射。
 *
 * 规格红线：返回的每个 index 都必须是 palette 中真实存在的颜色。
 * 聚类中心是合成色，但**只用来挑色卡**，绝不出现在任何输出里。
 *
 * 为什么从「加权 k-medoids」换成「k-means → 色卡映射」（1.2 变更）：
 * 旧算法以"覆盖权重 × 距离"贪心挑色卡色，大色块永远先占坑，眼睛、腮红、
 * 小饰物这类**样本少但色距远**的簇排不进 maxColors——小尺寸图纸上五官
 * 直接消失，是"失真"的主因之一。k-means 让每个足够密（或足够远）的簇
 * 都有自己的中心，中心再映射到最近的真实色卡色：小簇也能分到一个色号。
 *
 * 算法（完全确定，无随机数）：
 * 1. 样本按精确 RGB 折叠，weight = 出现次数（线性光无关，聚类在色卡度量空间）。
 * 2. 确定性初始化（最远点采样）：第一个中心 = 权重最大的样本；
 *    之后每轮取「weight × 到已选中心最小距离」最大的样本为中心，共 k 个。
 * 3. Lloyd 迭代（≤ 32 轮或收敛）：每轮按最近中心分配、按加权均值更新中心；
 *    空簇用「到已选中心加权距离最大的样本」补位。
 * 4. 每个中心映射到全色卡最近色；去重后若不足 k 个，
 *    用旧的贪心法（weight × minDistance 最大者的对应色卡色）补齐，
 *    仍不足则按色卡下标升序补齐，保证长度严格等于 min(maxColors, size)。
 * 5. 输出前按下标升序排序。
 *
 * 复杂度：O(u·n) 建映射 + O(32·k·u) 聚类 + O(k·n) 色卡映射。
 *
 * 确定性：
 * - 唯一样本先按 (r, g, b) 字典序全序排序，Map 插入顺序不会进入任何比较；
 * - 所有 argmax / argmin 严格比较，平局落到更小下标；
 * - 均值更新使用累加器，遍历顺序固定为唯一样本下标升序，浮点求和顺序固定。
 */

import type { ColorMetricName, RGB } from "../color";
import { indexPalette, readSpacePoint } from "./index-builder";
import type { PaletteSpace, SpacePoint } from "./index-builder";
import { PaletteError, assertSampleColor } from "./types";
import type { BeadColor } from "./types";

/** 每轮打分的初始最优值；任何非负 score 都会替换它。 */
const INITIAL_BEST_SCORE = -1;

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

  // 色卡数量不超过上限：全部返回，升序，不进入聚类。
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

  const targetCount = Math.min(maxColors, sampleCount);

  // ── 第一步：确定性初始化（最远点采样，按 weight × minDistance 打分）。──
  const centroids: SpacePoint[] = [];
  const centroidKeys: number[] = []; // 中心对应的唯一样本下标（平局裁决用）
  {
    const minDistances: number[] = new Array<number>(sampleCount).fill(Number.POSITIVE_INFINITY);

    const pickNext = (): number => {
      let bestSample = -1;
      let bestScore = -1;
      for (let index = 0; index < sampleCount; index += 1) {
        const score =
          readNumber(weights, index, "weights") * readNumber(minDistances, index, "minDistances");
        if (score > bestScore) {
          bestScore = score;
          bestSample = index;
        }
      }
      return bestSample;
    };

    // 第一个中心：权重最大的样本（覆盖最大的颜色）。
    let firstSample = 0;
    let bestWeight = -1;
    for (let index = 0; index < sampleCount; index += 1) {
      if (readNumber(weights, index, "weights") > bestWeight) {
        bestWeight = readNumber(weights, index, "weights");
        firstSample = index;
      }
    }
    centroids.push(readSpacePoint(samplePoints, firstSample));
    centroidKeys.push(firstSample);
    for (let index = 0; index < sampleCount; index += 1) {
      const firstCentroid = readSpacePoint(centroids, 0);
      minDistances[index] = space.distance(readSpacePoint(samplePoints, index), firstCentroid);
    }

    while (centroids.length < targetCount) {
      const next = pickNext();
      if (next < 0) break; // 不可达（sampleCount ≥ targetCount）
      const nextPoint = readSpacePoint(samplePoints, next);
      centroids.push(nextPoint);
      centroidKeys.push(next);
      for (let index = 0; index < sampleCount; index += 1) {
        const distance = space.distance(readSpacePoint(samplePoints, index), nextPoint);
        if (distance < readNumber(minDistances, index, "minDistances")) {
          minDistances[index] = distance;
        }
      }
    }
  }

  // ── 第二步：Lloyd 迭代（加权均值中心，≤ 32 轮或零换簇收敛）。
  // k=1 时跳过：单簇的质心是全分布的均值，映射后可能选出一个"谁都不是"的
  // 灰色（黑白图 → 灰豆）。此时保留最远点初始化的结果——覆盖权重最大的样本
  // 的对应色卡色，与「maxColors=1 返回覆盖最大者」的既有契约一致。
  const MAX_LLOYD_PASSES = 32;
  const assignments = new Int32Array(sampleCount);
  if (targetCount > 1) {
    for (let pass = 0; pass < MAX_LLOYD_PASSES; pass += 1) {
      let changed = false;
      for (let index = 0; index < sampleCount; index += 1) {
        const point = readSpacePoint(samplePoints, index);
        let best = 0;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (let c = 0; c < centroids.length; c += 1) {
          const distance = space.distance(point, readSpacePoint(centroids, c));
          if (distance < bestDistance) {
            bestDistance = distance;
            best = c;
          }
        }
        if (assignments[index] !== best) {
          assignments[index] = best;
          changed = true;
        }
      }
      if (!changed && pass > 0) break;

      // 加权均值更新；空簇用「weight × minDistance 最大的样本」补位。
      const sums = centroids.map(() => ({ L: 0, a: 0, b: 0, weight: 0 }));
      for (let index = 0; index < sampleCount; index += 1) {
        const cluster = assignments[index] ?? 0;
        const bucket = sums[cluster];
        if (bucket === undefined) continue;
        const weight = readNumber(weights, index, "weights");
        const point = readSpacePoint(samplePoints, index);
        bucket.L += weight * point.L;
        bucket.a += weight * point.a;
        bucket.b += weight * point.b;
        bucket.weight += weight;
      }
      for (let c = 0; c < centroids.length; c += 1) {
        const bucket = sums[c];
        if (bucket === undefined) continue;
        if (bucket.weight > 0) {
          centroids[c] = {
            L: bucket.L / bucket.weight,
            a: bucket.a / bucket.weight,
            b: bucket.b / bucket.weight,
          };
        } else {
          // 空簇：取离所有已选中心加权距离最大的样本作新中心。
          let bestSample = -1;
          let bestScore = -1;
          for (let index = 0; index < sampleCount; index += 1) {
            let minDistance = Number.POSITIVE_INFINITY;
            for (const center of centroids) {
              const distance = space.distance(readSpacePoint(samplePoints, index), center);
              if (distance < minDistance) minDistance = distance;
            }
            const score = readNumber(weights, index, "weights") * minDistance;
            if (score > bestScore) {
              bestScore = score;
              bestSample = index;
            }
          }
          if (bestSample >= 0) {
            centroids[c] = readSpacePoint(samplePoints, bestSample);
            centroidKeys[c] = bestSample;
          }
        }
      }
    }
  }

  // ── 第三步：中心 → 真实色卡映射（按簇权重大小排序，去重）。──
  const clusterWeights = centroids.map((_, c) => {
    let total = 0;
    for (let index = 0; index < sampleCount; index += 1) {
      if (assignments[index] === c) total += readNumber(weights, index, "weights");
    }
    return total;
  });
  const order = centroids
    .map((_, c) => c)
    .sort((first, second) => {
      const firstWeight = readNumber(clusterWeights, first, "clusterWeights");
      const secondWeight = readNumber(clusterWeights, second, "clusterWeights");
      if (firstWeight !== secondWeight) {
        return secondWeight - firstWeight;
      }
      return (
        readNumber(centroidKeys, first, "centroidKeys") -
        readNumber(centroidKeys, second, "centroidKeys")
      );
    });

  const selected: number[] = [];
  const isSelected: boolean[] = new Array<boolean>(paletteSize).fill(false);
  const markSelected = (index: number): void => {
    if (index >= 0 && index < paletteSize && !isSelected[index]) {
      isSelected[index] = true;
      selected.push(index);
    }
  };

  for (const cluster of order) {
    const nearest = nearestPaletteIndex(space, readSpacePoint(centroids, cluster));
    markSelected(nearest);
  }

  // ── 第四步：不足 k 个时补齐（映射撞色 / 簇数 < k 的情况）。
  // 先按旧的贪心分数（weight × minDistance）补，再按色卡下标补，保证严格等于
  // min(maxColors, paletteSize)。
  if (selected.length < maxColors) {
    const minDistances: number[] = new Array<number>(sampleCount).fill(Number.POSITIVE_INFINITY);
    for (const index of selected) {
      const point = readSpacePoint(space.points, index);
      for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
        const distance = space.distance(readSpacePoint(samplePoints, sampleIndex), point);
        if (distance < readNumber(minDistances, sampleIndex, "minDistances")) {
          minDistances[sampleIndex] = distance;
        }
      }
    }
    while (selected.length < maxColors && selected.length < paletteSize) {
      let candidateIndex = -1;
      let bestScore = INITIAL_BEST_SCORE;
      for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
        const assigned = nearestPaletteIndex(space, readSpacePoint(samplePoints, sampleIndex));
        if (isSelected[assigned]) continue;
        const score =
          readNumber(weights, sampleIndex, "weights") *
          readNumber(minDistances, sampleIndex, "minDistances");
        // 严格 `>`，平局取更小色卡下标。
        if (score > bestScore || (score === bestScore && assigned < candidateIndex)) {
          bestScore = score;
          candidateIndex = assigned;
        }
      }
      if (candidateIndex < 0) {
        for (let paletteIndex = 0; paletteIndex < paletteSize; paletteIndex += 1) {
          if (!isSelected[paletteIndex]) {
            candidateIndex = paletteIndex;
            break;
          }
        }
      }
      if (candidateIndex < 0) break;
      markSelected(candidateIndex);
      const point = readSpacePoint(space.points, candidateIndex);
      for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
        const distance = space.distance(readSpacePoint(samplePoints, sampleIndex), point);
        if (distance < readNumber(minDistances, sampleIndex, "minDistances")) {
          minDistances[sampleIndex] = distance;
        }
      }
    }
  }

  // 返回升序下标。数值比较器对互不相同的整数是严格全序，不依赖原选择顺序。
  selected.sort((first, second) => first - second);
  return selected;
}
