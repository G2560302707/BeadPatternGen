/**
 * S09b · 色块平整化（多数投票平滑 + 小碎片合并，纯函数，确定性）。
 *
 * 为什么需要：面积采样的格子颜色围绕物理色块的均值散布，逐格独立做最近邻
 * 匹配会让同一色块内的相邻格子落到**不同的豆色**上——小尺寸图纸上表现为
 * 满图斑噪（基线测试中 52 格图纸孤立豆 101–430 个、碎片 124–520 个）。
 * 对照优秀作品（算法优化库 52×52/18 色、104×104/13 色），它们的大色块
 * 内部是零噪点的纯色。这一步把"散布"收敛回"色块"：
 *
 * - 多数投票：一个格子的 4 邻域中有 ≥ 3 个是同色 C，且 ΔE(当前, C) 不超过
 *   模式的合并阈值，就改成 C。直线边缘上的格子只有 2 个同色邻格、角上只有
 *   1 个，永远不会被误平；眼睛高光、描边等真细节与周围色差大，被 ΔE 门槛保护。
 * - 小碎片合并：4 连通分量 ≤ 2 格的碎片并入相邻分量中色距最近的那个
 *   （ΔE ≤ 1.5 × 合并阈值才并）。孤豆由 S09 的 refineLocally 负责，这里管
 *   它管不到的 2 格碎片。
 *
 * 确定性契约：扫描顺序固定 row-major；所有 argmax/argmin 严格比较，平局取
 * 更小下标；不用随机数、不用 Map/Set 遍历顺序。多次调用（不动点后）结果不变。
 */

import { deltaE2000, deltaEOklab, hexToRgb, rgbToLab, rgbToOklab } from "../color";
import type { ColorMetricName } from "../color";
import type { BeadColor } from "../palette";

const EMPTY_CELL = -1;

const NEIGHBORS_4: readonly (readonly [number, number])[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

export interface FlattenOptions {
  width: number;
  height: number;
  /** 最近邻匹配后的格子；不会被修改。 */
  cells: Int16Array;
  palette: readonly BeadColor[];
  metric: ColorMetricName;
  /** 与 S09 一致的合并阈值（CIEDE2000 / Oklab 单位）。 */
  mergeThreshold: number;
  /** 整体循环轮数上限；默认 4。 */
  maxPasses?: number;
  /**
   * 特征锁掩码（S11，可空）：locked[i] = 1 的格子不被改写。
   * 锁定格仍可作为邻居参与投票——它周围格子的多数判定需要看到真实颜色。
   * 长度必须等于 width*height。
   */
  locked?: Uint8Array | null;
}

/** 色卡下标 → 色彩空间点。 */
function palettePoints(
  palette: readonly BeadColor[],
  metric: ColorMetricName,
): { points: Float64Array; distance: (a: number, b: number) => number } {
  const count = palette.length;
  const points = new Float64Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const hex = palette[index]?.hex;
    if (typeof hex !== "string") {
      throw new RangeError(`palette[${index}].hex must be a string`);
    }
    const rgb = hexToRgb(hex);
    const lab = metric === "ciede2000" ? rgbToLab(rgb) : rgbToOklab(rgb);
    points[index * 3] = lab.L;
    points[index * 3 + 1] = lab.a;
    points[index * 3 + 2] = lab.b;
  }
  const distance = (a: number, b: number): number => {
    if (a === b) return 0;
    const first = {
      L: points[a * 3] ?? 0,
      a: points[a * 3 + 1] ?? 0,
      b: points[a * 3 + 2] ?? 0,
    };
    const second = {
      L: points[b * 3] ?? 0,
      a: points[b * 3 + 1] ?? 0,
      b: points[b * 3 + 2] ?? 0,
    };
    return metric === "ciede2000" ? deltaE2000(first, second) : deltaEOklab(first, second);
  };
  return { points, distance };
}

/**
 * 一轮多数投票：4 邻域中 ≥ 3 个同色且色差在阈值内时改色。
 * 返回本轮改色数。就地修改传入数组（调用方已持有副本）。
 */
function majorityPass(
  cells: Int16Array,
  width: number,
  height: number,
  distance: (a: number, b: number) => number,
  mergeThreshold: number,
  locked: Uint8Array | null,
): number {
  let changed = 0;
  // 先收集后写回：一轮内的判定基于本轮开始时的状态，避免扫描方向偏差。
  const updates: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const current = cells[index];
      if (current === undefined || current === EMPTY_CELL) continue;
      if (locked != null && locked[index] === 1) continue;

      let bestColor = EMPTY_CELL;
      let bestCount = 0;
      let colorCount = 0;
      for (const [dx, dy] of NEIGHBORS_4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbor = cells[ny * width + nx];
        if (neighbor === undefined || neighbor === EMPTY_CELL) continue;
        colorCount += 1;
        if (neighbor === bestColor) continue;
        // 统计该邻居色在 4 邻域中的出现次数（≤ 4，直接重扫，格子邻域极小）。
        let count = 0;
        for (const [ox, oy] of NEIGHBORS_4) {
          const mx = x + ox;
          const my = y + oy;
          if (mx < 0 || my < 0 || mx >= width || my >= height) continue;
          if (cells[my * width + mx] === neighbor) count += 1;
        }
        if (count > bestCount) {
          bestCount = count;
          bestColor = neighbor;
        }
      }

      if (
        bestColor !== EMPTY_CELL &&
        bestColor !== current &&
        bestCount >= 3 &&
        colorCount >= 3 &&
        distance(current, bestColor) <= mergeThreshold
      ) {
        updates.push(index, bestColor);
      }
    }
  }
  for (let i = 0; i < updates.length; i += 2) {
    const index = updates[i];
    const color = updates[i + 1];
    if (index !== undefined && color !== undefined && cells[index] !== color) {
      cells[index] = color;
      changed += 1;
    }
  }
  return changed;
}

interface ComponentInfo {
  color: number;
  size: number;
  cells: number[];
}

/** 4 连通分量标注（同色连通）。 */
function labelComponents(cells: Int16Array, width: number, height: number): ComponentInfo[] {
  const count = width * height;
  const visited = new Uint8Array(count);
  const stack: number[] = [];
  const components: ComponentInfo[] = [];

  for (let start = 0; start < count; start += 1) {
    if (visited[start] !== 0) continue;
    const color = cells[start];
    if (color === undefined || color === EMPTY_CELL) {
      visited[start] = 1;
      continue;
    }
    stack.length = 0;
    stack.push(start);
    visited[start] = 1;
    const memberCells: number[] = [];
    while (stack.length > 0) {
      const index = stack.pop();
      if (index === undefined) break;
      memberCells.push(index);
      const x = index % width;
      const y = (index - x) / width;
      for (const [dx, dy] of NEIGHBORS_4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighbor = ny * width + nx;
        if (visited[neighbor] !== 0) continue;
        if (cells[neighbor] !== color) continue;
        visited[neighbor] = 1;
        stack.push(neighbor);
      }
    }
    components.push({ color, size: memberCells.length, cells: memberCells });
  }
  return components;
}

/** 一轮小碎片合并：≤ 2 格的碎片并入相邻分量中色距最近者（ΔE ≤ 1.5×阈值）。 */
function fragmentPass(
  cells: Int16Array,
  width: number,
  height: number,
  distance: (a: number, b: number) => number,
  mergeThreshold: number,
  locked: Uint8Array | null,
): number {
  const components = labelComponents(cells, width, height);
  const componentOf = new Int32Array(cells.length).fill(-1);
  for (let c = 0; c < components.length; c += 1) {
    const info = components[c];
    if (!info) continue;
    for (const index of info.cells) componentOf[index] = c;
  }

  let changed = 0;
  const pending: Array<{ cells: number[]; to: number }> = [];
  for (const info of components) {
    if (info.size > 2) continue;
    // 含锁定格的碎片是 S11 认定的有意细节，不做碎片合并。
    if (locked != null && info.cells.some((index) => locked[index] === 1)) continue;
    // 相邻分量的色距最小者；平局取分量下标更小（更早出现、通常更大）者。
    let bestComponent = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const index of info.cells) {
      const x = index % width;
      const y = (index - x) / width;
      for (const [dx, dy] of NEIGHBORS_4) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const neighborIndex = ny * width + nx;
        const neighborComponent = componentOf[neighborIndex];
        if (neighborComponent === undefined || neighborComponent < 0) continue;
        if (neighborComponent === componentOf[index]) continue;
        const neighborInfo = components[neighborComponent];
        if (!neighborInfo) continue;
        const d = distance(info.color, neighborInfo.color);
        if (d < bestDistance || (d === bestDistance && neighborComponent < bestComponent)) {
          bestDistance = d;
          bestComponent = neighborComponent;
        }
      }
    }
    const target = bestComponent >= 0 ? components[bestComponent] : undefined;
    if (
      target &&
      bestDistance <= mergeThreshold * 1.5 &&
      target.color !== info.color
    ) {
      pending.push({ cells: info.cells, to: target.color });
    }
  }

  for (const { cells: memberCells, to } of pending) {
    for (const index of memberCells) {
      if (cells[index] !== to) {
        cells[index] = to;
        changed += 1;
      }
    }
  }
  return changed;
}

/**
 * 色块平整化主入口。返回新的 `Int16Array`，不修改入参。
 *
 * 循环：多数投票（直到一轮零改色，至多 3 轮）→ 小碎片合并 → 下一大轮，
 * 直到某大轮两个子步骤都零改色或达到 `maxPasses`。
 */
export function flattenRegions(options: FlattenOptions): Int16Array {
  const { width, height, palette, metric, mergeThreshold } = options;
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new RangeError(`width/height must be positive integers; got ${width}×${height}`);
  }
  if (options.cells.length !== width * height) {
    throw new RangeError(
      `cells.length must equal width*height=${width * height}; got ${options.cells.length}`,
    );
  }
  if (palette.length === 0) {
    throw new RangeError("palette must be non-empty");
  }
  if (!Number.isFinite(mergeThreshold) || mergeThreshold < 0) {
    throw new RangeError(`mergeThreshold must be a non-negative finite number; got ${mergeThreshold}`);
  }
  if (options.locked != null && options.locked.length !== width * height) {
    throw new RangeError(
      `locked.length must equal width*height=${width * height}; got ${options.locked.length}`,
    );
  }

  const result = new Int16Array(options.cells.length);
  result.set(options.cells);
  const { distance } = palettePoints(palette, metric);
  const maxPasses = options.maxPasses ?? 4;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    let totalChanged = 0;
    // 多数投票的色差门槛放宽 1.4×：3/4 邻域一致已经是强空间证据，
    // 保守阈值会让低对比色块（浅粉开衫、米白发梢）残留成片散点。
    for (let sweep = 0; sweep < 3; sweep += 1) {
      const changed = majorityPass(result, width, height, distance, mergeThreshold * 1.4, options.locked ?? null);
      totalChanged += changed;
      if (changed === 0) break;
    }
    totalChanged += fragmentPass(result, width, height, distance, mergeThreshold, options.locked ?? null);
    if (totalChanged === 0) break;
  }

  return result;
}
