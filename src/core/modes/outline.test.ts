/**
 * S11 · 主体描边 / 边界锐化 / 特征锁 —— 单元测试。
 *
 * 覆盖：
 * - computeRimMask：满幅、镂空、斜向轮廓连续性、alpha 阈值边界；
 * - chooseOutlineAnchor：三分支（深色主体 / 暖调主体 / 默认近黑）+ 平局取小下标；
 * - applyOutlineToSamples：只改轮廓格、不改入参；
 * - reserveOutlineIndex：并入 / 已含两种路径与长度上限；
 * - computeFeatureLock：高对比小分量锁定、低对比与大分量不锁；
 * - snapBoundaries：骑界格归入深色侧、容差外不动、幂等；
 * - generatePattern 集成：anime 模式轮廓调和为深色调、锚色仍预留，landscape 不描边；
 */

import { describe, expect, it } from "vitest";
import type { BeadColor } from "../pattern";
import { generatePattern } from "../pipeline/generate";
import type { GenerateInput } from "../pipeline/generate";
import {
  applyOutlineToSamples,
  blendRimColors,
  chooseOutlineAnchor,
  computeFeatureLock,
  computeRimMask,
  reserveOutlineIndex,
  rimSkipThreshold,
  snapBoundaries,
} from "./outline";

const PALETTE: BeadColor[] = [
  { code: "W", name: "White", hex: "#FFFFFF", manufacturer: "Test" },
  { code: "K", name: "Black", hex: "#0A0A0A", manufacturer: "Test" },
  { code: "G", name: "MidGray", hex: "#2C2C2C", manufacturer: "Test" },
  { code: "M", name: "WarmDark", hex: "#5A4038", manufacturer: "Test" },
  { code: "R", name: "Red", hex: "#E03A3A", manufacturer: "Test" },
  { code: "S", name: "Skin", hex: "#E8B48C", manufacturer: "Test" },
];
const W = 0;
const K = 1;
const G = 2;
const M = 3;
const R = 4;

function gridCells(width: number, height: number, painter: (x: number, y: number) => number): Int16Array {
  const cells = new Int16Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      cells[y * width + x] = painter(x, y);
    }
  }
  return cells;
}

function gridAlpha(width: number, height: number, painter: (x: number, y: number) => number): Uint8Array {
  const alpha = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      alpha[y * width + x] = painter(x, y);
    }
  }
  return alpha;
}

describe("computeRimMask", () => {
  it("满幅不透明图：画布边缘一圈是轮廓（画布外按空格处理）", () => {
    const alpha = gridAlpha(5, 5, () => 255);
    const rim = computeRimMask(alpha, 5, 5);
    const expected = gridCells(5, 5, (x, y) => (x === 0 || y === 0 || x === 4 || y === 4 ? 1 : 0));
    expect(Array.from(rim)).toEqual(Array.from(new Int16Array(expected)));
  });

  it("透明底中央 4×4 主体：主体最外圈是轮廓，背景不是", () => {
    const alpha = gridAlpha(8, 8, (x, y) => (x >= 2 && x <= 5 && y >= 2 && y <= 5 ? 255 : 0));
    const rim = computeRimMask(alpha, 8, 8);
    const expected = gridCells(8, 8, (x, y) => {
      const inBox = x >= 2 && x <= 5 && y >= 2 && y <= 5;
      if (!inBox) return 0;
      const onRim = x === 2 || x === 5 || y === 2 || y === 5;
      return onRim ? 1 : 0;
    });
    expect(Array.from(rim)).toEqual(Array.from(new Int16Array(expected)));
  });

  it("斜向轮廓连续：菱形主体除中心外都是轮廓（8 邻接检测）", () => {
    // 5×5 菱形：|x-2|+|y-2| <= 2。除中心 (2,2) 的 8 邻全在菱形内，
    // 其余每格都有空格 8 邻居 → 都是轮廓，斜边不会出现断点。
    const alpha = gridAlpha(5, 5, (x, y) => (Math.abs(x - 2) + Math.abs(y - 2) <= 2 ? 255 : 0));
    const rim = computeRimMask(alpha, 5, 5);
    const expected = gridCells(5, 5, (x, y) => {
      const inDiamond = Math.abs(x - 2) + Math.abs(y - 2) <= 2;
      const isCenter = x === 2 && y === 2;
      return inDiamond && !isCenter ? 1 : 0;
    });
    expect(Array.from(rim)).toEqual(Array.from(new Int16Array(expected)));
  });

  it("alpha=127 算空格、128 算主体（与采样阈值一致）", () => {
    const alpha = new Uint8Array([127, 128]);
    const rim = computeRimMask(alpha, 2, 1);
    expect(rim[0]).toBe(0);
    expect(rim[1]).toBe(1);
  });

  it("形状校验：alpha 长度不符抛 RangeError", () => {
    expect(() => computeRimMask(new Uint8Array(3), 2, 2)).toThrow(RangeError);
  });
});

describe("chooseOutlineAnchor", () => {
  const metric = "ciede2000";

  it("深色主体 → 中灰（黑上黑无分离度）", () => {
    const anchor = chooseOutlineAnchor([{ r: 30, g: 30, b: 34 }], PALETTE, metric, 45);
    expect(anchor.index).toBe(G);
    expect(anchor.rule).toBe("dark-subject");
  });

  it("暖调主体（肤色）→ 暖深灰", () => {
    const anchor = chooseOutlineAnchor([{ r: 232, g: 180, b: 140 }], PALETTE, metric, 45);
    expect(anchor.index).toBe(M);
    expect(anchor.rule).toBe("warm-subject");
  });

  it("默认（冷调 / 低饱和亮色主体）→ 近黑", () => {
    const anchor = chooseOutlineAnchor([{ r: 235, g: 240, b: 245 }], PALETTE, metric, 45);
    expect(anchor.index).toBe(K);
    expect(anchor.rule).toBe("default");
  });

  it("红头发不算暖扇区（Lab 色相约 20°）→ 近黑", () => {
    const anchor = chooseOutlineAnchor([{ r: 224, g: 58, b: 58 }], PALETTE, metric, 45);
    expect(anchor.rule).toBe("default");
  });

  it("空样本抛 RangeError；锚色 RGB 来自真实色卡", () => {
    expect(() => chooseOutlineAnchor([], PALETTE, metric, 45)).toThrow(RangeError);
    const anchor = chooseOutlineAnchor([{ r: 10, g: 10, b: 10 }], PALETTE, metric, 45);
    expect(anchor.rgb).toEqual({ r: 0x2c, g: 0x2c, b: 0x2c });
  });
});

describe("applyOutlineToSamples", () => {
  it("只改轮廓格，入参缓冲不被修改", () => {
    const rgb = new Uint8ClampedArray([
      255, 255, 255, // 0
      255, 255, 255, // 1
      255, 255, 255, // 2
      255, 255, 255, // 3
    ]);
    const rim = new Uint8Array([1, 0, 0, 1]);
    const out = applyOutlineToSamples(rgb, rim, { r: 10, g: 10, b: 10 });
    expect(Array.from(out.slice(0, 3))).toEqual([10, 10, 10]);
    expect(Array.from(out.slice(3, 9))).toEqual([255, 255, 255, 255, 255, 255]);
    expect(Array.from(out.slice(9, 12))).toEqual([10, 10, 10]);
    expect(Array.from(rgb)).toEqual(new Array(12).fill(255));
  });
});

describe("reserveOutlineIndex", () => {
  it("未包含锚色时并入并升序", () => {
    expect(reserveOutlineIndex([4, 1], 2, 3)).toEqual([1, 2, 4]);
  });

  it("已包含锚色时原样返回（排序副本）", () => {
    expect(reserveOutlineIndex([2, 4], 2, 3)).toEqual([2, 4]);
  });

  it("超过 maxColors 抛 RangeError（调用方契约违规）", () => {
    expect(() => reserveOutlineIndex([0, 1, 2], 3, 3)).toThrow(RangeError);
  });
});

describe("computeFeatureLock", () => {
  const metric = "ciede2000";

  it("浅色区域中的孤立深色格（瞳孔）被锁定", () => {
    // 5×5 全白 + 中心黑
    const cells = gridCells(5, 5, (x, y) => (x === 2 && y === 2 ? K : W));
    const locked = computeFeatureLock(cells, 5, 5, PALETTE, metric, 4, 25);
    expect(locked[12]).toBe(1);
    const lockedCount = Array.from(locked).filter((v) => v === 1).length;
    expect(lockedCount).toBe(1);
  });

  it("低对比小色块不锁（那是斑噪，交给 flatten 收敛）", () => {
    // 全白 + 中心浅灰（ΔE 远小于 25）
    const cells = gridCells(5, 5, (x, y) => (x === 2 && y === 2 ? K : W));
    const locked = computeFeatureLock(cells, 5, 5, PALETTE, metric, 4, 200);
    expect(Array.from(locked).every((v) => v === 0)).toBe(true);
  });

  it("大色块不锁（尺寸超限）", () => {
    // 左半红右半白：红分量 8 格 > maxSize 3
    const cells = gridCells(4, 4, (x) => (x < 2 ? R : W));
    const locked = computeFeatureLock(cells, 4, 4, PALETTE, metric, 3, 25);
    expect(Array.from(locked).every((v) => v === 0)).toBe(true);
  });

  it("双格眼睛（2 格同色高对比）整体锁定", () => {
    const cells = gridCells(5, 5, (x, y) => (x >= 2 && x <= 3 && y === 2 ? K : W));
    const locked = computeFeatureLock(cells, 5, 5, PALETTE, metric, 4, 25);
    expect(locked[12]).toBe(1);
    expect(locked[13]).toBe(1);
  });
});

describe("snapBoundaries", () => {
  const metric = "ciede2000";

  function makeSnapGrid() {
    // 3×3：左列白、右列红、中列采样是两侧混合、当前被量化成白。
    // 构造：中列采样 = 偏红的粉，与红侧色差明显小于与白侧的色差，
    // 处于「容差允许倒向深色侧」的情形。
    const cells = new Int16Array([W, W, R, W, W, R, W, W, R]);
    const rgb = new Uint8ClampedArray(9 * 3);
    const white = [245, 245, 245];
    const red = [224, 58, 58];
    const blend = [205, 105, 105]; // 骑界格：偏红
    for (let y = 0; y < 3; y += 1) {
      rgb.set(white, (y * 3 + 0) * 3);
      rgb.set(blend, (y * 3 + 1) * 3);
      rgb.set(red, (y * 3 + 2) * 3);
    }
    return { cells, rgb };
  }

  it("骑界格在容差内归入较深一侧（红比白深）", () => {
    const { cells, rgb } = makeSnapGrid();
    const snapped = snapBoundaries({
      width: 3,
      height: 3,
      cells,
      rgb,
      palette: PALETTE,
      metric,
      snapDelta: 10,
      snapTolerance: 12,
    });
    expect(snapped[1]).toBe(R);
    expect(snapped[4]).toBe(R);
    expect(snapped[7]).toBe(R);
    // 两侧本色的格子不动。
    expect(snapped[0]).toBe(W);
    expect(snapped[2]).toBe(R);
  });

  it("容差不足时不动（保真度优先）", () => {
    // 偏白的骑界格：与红侧色差 (28.4) 大于与白侧色差 (23.0)，
    // 容差 0.5 不足以倒向深侧 → 不动；容差 12 时才会动（语义由上例覆盖）。
    const cells = new Int16Array([W, W, R, W, W, R, W, W, R]);
    const rgb = new Uint8ClampedArray(9 * 3);
    for (let y = 0; y < 3; y += 1) {
      rgb.set([245, 245, 245], (y * 3 + 0) * 3);
      rgb.set([238, 180, 180], (y * 3 + 1) * 3);
      rgb.set([224, 58, 58], (y * 3 + 2) * 3);
    }
    const snapped = snapBoundaries({
      width: 3,
      height: 3,
      cells,
      rgb,
      palette: PALETTE,
      metric,
      snapDelta: 10,
      snapTolerance: 0.5,
    });
    expect(Array.from(snapped)).toEqual(Array.from(cells));
  });

  it("只加深不减淡：把深色格换成浅色候选的场景不成立时不动", () => {
    // 中列当前已是红（深），邻居白更浅 → 不允许倒向浅色。
    const cells = new Int16Array([W, R, R, W, R, R, W, R, R]);
    const rgb = new Uint8ClampedArray(9 * 3);
    for (let y = 0; y < 3; y += 1) {
      rgb.set([245, 245, 245], (y * 3 + 0) * 3);
      rgb.set([205, 105, 105], (y * 3 + 1) * 3);
      rgb.set([224, 58, 58], (y * 3 + 2) * 3);
    }
    const snapped = snapBoundaries({
      width: 3,
      height: 3,
      cells,
      rgb,
      palette: PALETTE,
      metric,
      snapDelta: 10,
      snapTolerance: 12,
    });
    expect(snapped[1]).toBe(R);
  });

  it("锁定格与轮廓格不参与锐化", () => {
    const { cells, rgb } = makeSnapGrid();
    const locked = new Uint8Array(9);
    locked[4] = 1;
    const rimMask = new Uint8Array(9);
    rimMask[1] = 1;
    rimMask[7] = 1;
    const snapped = snapBoundaries({
      width: 3,
      height: 3,
      cells,
      rgb,
      palette: PALETTE,
      metric,
      snapDelta: 10,
      snapTolerance: 12,
      locked,
      rimMask,
    });
    expect(snapped[1]).toBe(W); // rim 跳过
    expect(snapped[4]).toBe(W); // locked 跳过
    expect(snapped[7]).toBe(W); // rim 跳过
  });

  it("幂等：第二次调用结果不变", () => {
    const { cells, rgb } = makeSnapGrid();
    const options = {
      width: 3,
      height: 3,
      cells,
      rgb,
      palette: PALETTE,
      metric,
      snapDelta: 10,
      snapTolerance: 12,
    } as const;
    const first = snapBoundaries(options);
    const second = snapBoundaries({ ...options, cells: first });
    expect(Array.from(second)).toEqual(Array.from(first));
  });
});

describe("generatePattern × S11 集成", () => {
  function makeInput(overrides: Partial<GenerateInput> = {}): GenerateInput {
    // 7×7 透明底中央 5×5 亮红主体 → 轮廓 = 5×5 外圈 16 格。
    const width = 7;
    const height = 7;
    const rgb = new Uint8ClampedArray(width * height * 3);
    const alpha = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        const inBox = x >= 1 && x <= 5 && y >= 1 && y <= 5;
        rgb[index * 3] = inBox ? 224 : 0;
        rgb[index * 3 + 1] = inBox ? 58 : 0;
        rgb[index * 3 + 2] = inBox ? 58 : 0;
        alpha[index] = inBox ? 255 : 0;
      }
    }
    return {
      rgb,
      alpha,
      width,
      height,
      palette: PALETTE,
      paletteId: "test",
      paletteVersion: "1",
      maxColors: 4,
      mode: "anime",
      dithering: "none",
      colorMetric: "ciede2000",
      transparentPolicy: "empty",
      ditherStrength: 1,
      source: { originalWidth: 7, originalHeight: 7, aspectRatio: 1 },
      title: "outline-test",
      id: "outline-test",
      now: "2026-10-25T00:00:00.000Z",
      ...overrides,
    };
  }

  it("anime 模式：红色主体轮廓调和为深红棕、全局锚色仍预留一个色位", () => {
    const result = generatePattern(makeInput());
    const cells = Array.from(result.pattern.cells);
    // S11.1：轮廓 = 内侧红压暗的调和色（深色族最近 = 暖深棕 M）。
    // 全局锚色（近黑）不再直接上墙，但选色预留保证它仍在工作色板。
    const paletteHexes = result.pattern.palette.map((color) => color.hex);
    expect(paletteHexes).toContain("#0A0A0A");

    const rimIndexes: number[] = [];
    for (let y = 1; y <= 5; y += 1) {
      for (let x = 1; x <= 5; x += 1) {
        const onRim = x === 1 || x === 5 || y === 1 || y === 5;
        if (onRim) rimIndexes.push(y * 7 + x);
      }
    }
    for (const index of rimIndexes) {
      expect(result.pattern.palette[cells[index] ?? -1]?.hex).toBe("#5A4038");
    }
    // 内部 3×3 仍是主体红。
    expect(result.pattern.palette[cells[3 * 7 + 3] ?? -1]?.hex).toBe("#E03A3A");
  });

  it("landscape 模式 rim=false：不描边，轮廓格与内部同为红色", () => {
    const result = generatePattern(makeInput({ mode: "landscape" }));
    const cells = Array.from(result.pattern.cells);
    // 主体轮廓格 (1,1) 与中心格都保持主体红；描边关闭时不产生黑环。
    expect(result.pattern.palette[cells[1 * 7 + 1] ?? -1]?.hex).toBe("#E03A3A");
    expect(result.pattern.palette[cells[3 * 7 + 3] ?? -1]?.hex).toBe("#E03A3A");
  });

  it("maxColors=2 时描边整体关闭（不占色位、不报错）", () => {
    const result = generatePattern(makeInput({ maxColors: 2 }));
    const paletteHexes = result.pattern.palette.map((color) => color.hex);
    expect(paletteHexes).toHaveLength(2);
    expect(result.pattern.palette[Array.from(result.pattern.cells)[24] ?? -1]?.hex).toBe("#E03A3A");
  });

  it("确定性：同一输入两次生成结果相同", () => {
    const first = generatePattern(makeInput());
    const second = generatePattern(makeInput());
    expect(Array.from(first.pattern.cells)).toEqual(Array.from(second.pattern.cells));
    expect(first.pattern.palette.map((c) => c.hex)).toEqual(
      second.pattern.palette.map((c) => c.hex),
    );
  });
});

// ── S11.1 · 描边中和 ─────────────────────────────────────────────────────────

describe("rimSkipThreshold", () => {
  it("强度 1 → 30（全描）、0.75 → 46.25（中和档）、0 → 95（近乎关闭）", () => {
    expect(rimSkipThreshold(1)).toBe(30);
    expect(rimSkipThreshold(0.75)).toBeCloseTo(46.25, 5);
    expect(rimSkipThreshold(0)).toBe(95);
  });

  it("越界抛 RangeError", () => {
    expect(() => rimSkipThreshold(-0.1)).toThrow(RangeError);
    expect(() => rimSkipThreshold(1.1)).toThrow(RangeError);
  });
});

describe("blendRimColors", () => {
  const metric = "ciede2000";

  /** 7×7：透明底中央 5×5 主体，painter 控制主体色；返回 (rgb, alpha, rimMask)。 */
  function makeSubject(subjectRgba: [number, number, number]) {
    const width = 7;
    const height = 7;
    const rgb = new Uint8ClampedArray(width * height * 3);
    const alpha = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        const inBox = x >= 1 && x <= 5 && y >= 1 && y <= 5;
        rgb[index * 3] = inBox ? subjectRgba[0] : 0;
        rgb[index * 3 + 1] = inBox ? subjectRgba[1] : 0;
        rgb[index * 3 + 2] = inBox ? subjectRgba[2] : 0;
        alpha[index] = inBox ? 255 : 0;
      }
    }
    const rimMask = computeRimMask(alpha, width, height);
    return { rgb, alpha, rimMask, width, height };
  }

  it("暖肤色主体：轮廓调和为暖深棕（M #5A4038）而非全局近黑锚色", () => {
    const { rgb, alpha, rimMask, width, height } = makeSubject([232, 180, 140]);
    const anchor = chooseOutlineAnchor([{ r: 232, g: 180, b: 140 }], PALETTE, metric, 45);
    const blend = blendRimColors({
      width,
      height,
      rgb,
      alpha,
      palette: PALETTE,
      metric,
      rimMask,
      anchor: anchor.rgb,
      skipL: rimSkipThreshold(0.75),
    });
    expect(blend.painted).toBe(16);
    // 轮廓上任意一格的颜色是暖深棕，不是纯黑锚。
    expect(Array.from(blend.rgb.slice((1 * 7 + 1) * 3, (1 * 7 + 1) * 3 + 3))).toEqual([0x5a, 0x40, 0x38]);
  });

  it("深色主体（内侧 L < skipL）豁免：黑发边缘保持原色不描", () => {
    const { rgb, alpha, rimMask, width, height } = makeSubject([26, 26, 26]);
    const anchor = chooseOutlineAnchor([{ r: 26, g: 26, b: 26 }], PALETTE, metric, 45);
    const blend = blendRimColors({
      width,
      height,
      rgb,
      alpha,
      palette: PALETTE,
      metric,
      rimMask,
      anchor: anchor.rgb,
      skipL: rimSkipThreshold(0.75),
    });
    expect(blend.skipped).toBe(16);
    expect(blend.painted).toBe(0);
    // 豁免格的采样色保持不变。
    expect(Array.from(blend.rgb.slice((1 * 7 + 1) * 3, (1 * 7 + 1) * 3 + 3))).toEqual([26, 26, 26]);
  });

  it("低强度几乎不描：strength=0 时浅色主体也被豁免", () => {
    const { rgb, alpha, rimMask, width, height } = makeSubject([235, 235, 240]);
    const anchor = chooseOutlineAnchor([{ r: 235, g: 235, b: 240 }], PALETTE, metric, 45);
    const blend = blendRimColors({
      width,
      height,
      rgb,
      alpha,
      palette: PALETTE,
      metric,
      rimMask,
      anchor: anchor.rgb,
      skipL: rimSkipThreshold(0),
    });
    expect(blend.painted).toBe(0);
  });

  it("1 格宽细部（无内侧参考）描全局锚色", () => {
    // 3×1：中间 1 格主体，左右透明 → 轮廓格无任何非空 4 邻。
    // 肤色主体的锚色 = 暖深灰 M（#5A4038）。
    const width = 3;
    const height = 1;
    const rgb = new Uint8ClampedArray([0, 0, 0, 232, 180, 140, 0, 0, 0]);
    const alpha = new Uint8Array([0, 255, 0]);
    const rimMask = computeRimMask(alpha, width, height);
    const anchor = chooseOutlineAnchor([{ r: 232, g: 180, b: 140 }], PALETTE, metric, 45);
    const blend = blendRimColors({
      width,
      height,
      rgb,
      alpha,
      palette: PALETTE,
      metric,
      rimMask,
      anchor: anchor.rgb,
      skipL: rimSkipThreshold(0.75),
    });
    expect(blend.painted).toBe(1);
    expect(Array.from(blend.rgb.slice(3, 6))).toEqual([0x5a, 0x40, 0x38]);
  });
});

describe("generatePattern × S11.1 中和集成", () => {
  function makeSkinInput(overrides: Partial<GenerateInput> = {}): GenerateInput {
    const width = 7;
    const height = 7;
    const rgb = new Uint8ClampedArray(width * height * 3);
    const alpha = new Uint8Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        const inBox = x >= 1 && x <= 5 && y >= 1 && y <= 5;
        rgb[index * 3] = inBox ? 232 : 0;
        rgb[index * 3 + 1] = inBox ? 180 : 0;
        rgb[index * 3 + 2] = inBox ? 140 : 0;
        alpha[index] = inBox ? 255 : 0;
      }
    }
    return {
      rgb,
      alpha,
      width,
      height,
      palette: PALETTE,
      paletteId: "test",
      paletteVersion: "1",
      maxColors: 4,
      mode: "anime",
      dithering: "none",
      colorMetric: "ciede2000",
      transparentPolicy: "empty",
      ditherStrength: 1,
      source: { originalWidth: 7, originalHeight: 7, aspectRatio: 1 },
      title: "blend-test",
      id: "blend-test",
      now: "2026-10-25T00:00:00.000Z",
      ...overrides,
    };
  }

  it("肤色主体轮廓 = 暖深棕（调和），不再是统一近黑", () => {
    const result = generatePattern(makeSkinInput());
    const cells = Array.from(result.pattern.cells);
    // 轮廓格 (1,1) 是暖深棕，中心 (3,3) 保持肤色。
    expect(result.pattern.palette[cells[1 * 7 + 1] ?? -1]?.hex).toBe("#5A4038");
    expect(result.pattern.palette[cells[3 * 7 + 3] ?? -1]?.hex).toBe("#E8B48C");
  });

  it("outlineStrength=0：描边实际关闭，轮廓格保持主体色", () => {
    const result = generatePattern(makeSkinInput({ outlineStrength: 0 }));
    const cells = Array.from(result.pattern.cells);
    expect(result.pattern.palette[cells[1 * 7 + 1] ?? -1]?.hex).toBe("#E8B48C");
    expect(result.pattern.palette[cells[3 * 7 + 3] ?? -1]?.hex).toBe("#E8B48C");
  });

  it("outlineStrength 越界抛 E_INVALID_SETTINGS", () => {
    try {
      generatePattern(makeSkinInput({ outlineStrength: 1.5 }));
      throw new Error("expected invalid outlineStrength");
    } catch (error) {
      expect((error as { code?: string }).code).toBe("E_INVALID_SETTINGS");
    }
  });

  it("确定性：调和描边下两次生成一致", () => {
    const first = generatePattern(makeSkinInput());
    const second = generatePattern(makeSkinInput());
    expect(Array.from(first.pattern.cells)).toEqual(Array.from(second.pattern.cells));
  });
});
