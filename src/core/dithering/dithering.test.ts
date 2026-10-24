import { describe, expect, it } from "vitest";
import type { RGB } from "../color";
import { buildPaletteIndex } from "../palette";
import type { BeadColor, PaletteIndex, PaletteMatch } from "../palette";
import { floydSteinberg } from "./index";
import type { DitherOptions } from "./index";

/**
 * 测试向量全部来自同目录的 VECTORS.md。
 *
 * 断言使用 `toBe` 而不是 `toBeCloseTo`：VECTORS.md §0.6 证明了本文件用到的
 * 全部中间值都是 float32 可精确表示的二进有理数，不存在末位不确定。
 */

function bead(code: string, hex: string, name: string = code): BeadColor {
  return { code, name, hex, manufacturer: "TEST" };
}

/** 2 色色卡：index 0 = 黑，index 1 = 白。 */
function makeTwoColorPalette(): BeadColor[] {
  return [bead("K", "#000000", "Black"), bead("W", "#FFFFFF", "White")];
}

function gray(value: number): RGB {
  return { r: value, g: value, b: value };
}

function makeMask(cellCount: number): boolean[] {
  return new Array<boolean>(cellCount).fill(false);
}

/** VECTORS.md §1.1 的 3×3 灰度输入。 */
function makeGray3x3(): RGB[] {
  return [0, 64, 128, 96, 160, 224, 32, 192, 255].map(gray);
}

/** VECTORS.md §3.1 的 1×3 竖列输入。 */
function makeGrayColumn(): RGB[] {
  return [110, 130, 96].map(gray);
}

/** 统计 nearest 调用次数，用于证明量化没有绕过 PaletteIndex。 */
function makeCountingIndex(base: PaletteIndex): {
  index: PaletteIndex;
  callCount: () => number;
} {
  let calls = 0;
  const index: PaletteIndex = {
    size: base.size,
    nearest(color: RGB, candidates?: readonly number[]): PaletteMatch {
      calls += 1;
      return base.nearest(color, candidates);
    },
  };
  return { index, callCount: () => calls };
}

function runGray3x3(
  strength: number,
  alphaMask: readonly boolean[] = makeMask(9),
  palette: BeadColor[] = makeTwoColorPalette(),
  index: PaletteIndex = buildPaletteIndex(palette, "oklab"),
  metric: DitherOptions["metric"] = "oklab",
) {
  return floydSteinberg(makeGray3x3(), alphaMask, 3, 3, palette, index, { strength, metric });
}

describe("V1 · 3×3 主向量（VECTORS.md §1）", () => {
  it("strength=1：逐格 indices 与 residualError 精确一致", () => {
    const palette = makeTwoColorPalette();
    const index = buildPaletteIndex(palette, "oklab");
    const result = floydSteinberg(makeGray3x3(), makeMask(9), 3, 3, palette, index, {
      strength: 1,
      metric: "oklab",
    });

    expect(result.indices).toBeInstanceOf(Int16Array);
    expect(result.indices.length).toBe(9);
    expect(Array.from(result.indices)).toEqual([0, 0, 1, 1, 0, 1, 0, 1, 1]);
    expect(result.residualError).toBe(386.4228515625);
  });
});

describe("V2 · strength=0 退化为逐格最近邻（VECTORS.md §2）", () => {
  it("indices 等于对原始采样逐格 nearest 的结果，residualError=0", () => {
    const palette = makeTwoColorPalette();
    const index = buildPaletteIndex(palette, "oklab");
    const samples = makeGray3x3();
    const result = floydSteinberg(samples, makeMask(9), 3, 3, palette, index, {
      strength: 0,
      metric: "oklab",
    });

    const expected = samples.map((sample) => index.nearest(sample).index);
    expect(Array.from(result.indices)).toEqual(expected);
    expect(Array.from(result.indices)).toEqual([0, 0, 1, 0, 1, 1, 0, 1, 1]);
    expect(result.residualError).toBe(0);
  });

  it("strength=0 与 strength=1 在格 3、格 4 上产生差异", () => {
    const atZero = runGray3x3(0);
    const atOne = runGray3x3(1);

    expect(atZero.indices[3]).toBe(0);
    expect(atOne.indices[3]).toBe(1);
    expect(atZero.indices[4]).toBe(1);
    expect(atOne.indices[4]).toBe(0);
  });

  it("对 ciede2000 索引同样成立（metric 由索引决定）", () => {
    const palette = makeTwoColorPalette();
    const ciedeIndex = buildPaletteIndex(palette, "ciede2000");
    const samples = makeGray3x3();
    const result = floydSteinberg(samples, makeMask(9), 3, 3, palette, ciedeIndex, {
      strength: 0,
      metric: "ciede2000",
    });

    expect(Array.from(result.indices)).toEqual(samples.map((s) => ciedeIndex.nearest(s).index));
    expect(result.residualError).toBe(0);
  });
});

describe("V3/V4 · 1×3 空格切断扩散链（VECTORS.md §3.1）", () => {
  it("无空格：格 2 收到 26.46484375 的误差并判白", () => {
    const palette = makeTwoColorPalette();
    const index = buildPaletteIndex(palette, "oklab");
    const result = floydSteinberg(makeGrayColumn(), [false, false, false], 1, 3, palette, index, {
      strength: 1,
      metric: "oklab",
    });

    expect(Array.from(result.indices)).toEqual([1, 0, 1]);
    expect(result.residualError).toBe(871.3359375);
  });

  it("格 1 为空：不接收、不发射，格 2 不再翻转", () => {
    const palette = makeTwoColorPalette();
    const index = buildPaletteIndex(palette, "oklab");
    const result = floydSteinberg(makeGrayColumn(), [false, true, false], 1, 3, palette, index, {
      strength: 1,
      metric: "oklab",
    });

    expect(Array.from(result.indices)).toEqual([1, -1, 0]);
    expect(result.residualError).toBe(723);

    // 断链证明：无空格时格 2 为 1，空格切断后为 0。
    expect(result.indices[2]).toBe(0);
  });
});

describe("V5 · 3×3 空格（VECTORS.md §3.2）", () => {
  it("空格输出 -1，指向它的误差计入 residualError，负累积值先夹到 0", () => {
    const palette = makeTwoColorPalette();
    const index = buildPaletteIndex(palette, "oklab");
    const mask = [false, false, false, false, true, false, false, false, false];
    const result = floydSteinberg(makeGray3x3(), mask, 3, 3, palette, index, {
      strength: 1,
      metric: "oklab",
    });

    expect(Array.from(result.indices)).toEqual([0, 0, 1, 1, -1, 1, 0, 1, 1]);
    expect(result.indices[4]).toBe(-1);
    // 格 6 累积值 −13.9375 被夹到 0，误差为 0，因此 index 仍是 0。
    expect(result.indices[6]).toBe(0);
    expect(result.residualError).toBe(930.1875);
  });
});

describe("V6 · 1×1 强度缩放（VECTORS.md §4）", () => {
  it("strength=1 / 0.5 / 0 的 residualError 分别为 192 / 96 / 0", () => {
    const palette = makeTwoColorPalette();
    const index = buildPaletteIndex(palette, "oklab");
    const samples = [gray(64)];

    const cases: ReadonlyArray<readonly [number, number]> = [
      [1, 192],
      [0.5, 96],
      [0, 0],
    ];

    for (const [strength, expected] of cases) {
      const result = floydSteinberg(samples, [false], 1, 1, palette, index, {
        strength,
        metric: "oklab",
      });
      expect(Array.from(result.indices)).toEqual([0]);
      expect(result.residualError).toBe(expected);
    }
  });

  it("strength 省略时默认取 1", () => {
    const palette = makeTwoColorPalette();
    const index = buildPaletteIndex(palette, "oklab");
    const samples = [gray(64)];
    const options = { metric: "oklab" } as unknown as DitherOptions;

    const result = floydSteinberg(samples, [false], 1, 1, palette, index, options);
    expect(result.residualError).toBe(192);
  });
});

describe("V7 · 确定性与纯函数性", () => {
  it("同输入连续两次调用结果完全一致，且不修改入参", () => {
    const palette = makeTwoColorPalette();
    const index = buildPaletteIndex(palette, "oklab");
    const samples = makeGray3x3();
    const alphaMask = [false, false, false, false, true, false, false, false, false];

    const samplesSnapshot = JSON.stringify(samples);
    const maskSnapshot = JSON.stringify(alphaMask);
    const paletteSnapshot = JSON.stringify(palette);

    const first = floydSteinberg(samples, alphaMask, 3, 3, palette, index, {
      strength: 1,
      metric: "oklab",
    });
    const second = floydSteinberg(samples, alphaMask, 3, 3, palette, index, {
      strength: 1,
      metric: "oklab",
    });

    expect(Array.from(second.indices)).toEqual(Array.from(first.indices));
    expect(second.residualError).toBe(first.residualError);
    expect(JSON.stringify(samples)).toBe(samplesSnapshot);
    expect(JSON.stringify(alphaMask)).toBe(maskSnapshot);
    expect(JSON.stringify(palette)).toBe(paletteSnapshot);
  });

  it("量化全部经由 PaletteIndex.nearest：调用次数 = 非空格数", () => {
    const palette = makeTwoColorPalette();
    const base = buildPaletteIndex(palette, "oklab");

    const plain = makeCountingIndex(base);
    floydSteinberg(makeGray3x3(), makeMask(9), 3, 3, palette, plain.index, {
      strength: 1,
      metric: "oklab",
    });
    expect(plain.callCount()).toBe(9);

    const masked = makeCountingIndex(base);
    const mask = [false, false, false, false, true, false, false, false, false];
    floydSteinberg(makeGray3x3(), mask, 3, 3, palette, masked.index, {
      strength: 1,
      metric: "oklab",
    });
    expect(masked.callCount()).toBe(8);
  });
});

describe("输入校验", () => {
  it("尺寸必须是正整数", () => {
    const palette = makeTwoColorPalette();
    const index = buildPaletteIndex(palette, "oklab");
    const samples = [gray(0)];

    expect(() =>
      floydSteinberg(samples, [false], 0, 1, palette, index, { strength: 1, metric: "oklab" }),
    ).toThrow(RangeError);
    expect(() =>
      floydSteinberg(samples, [false], 1, 0, palette, index, { strength: 1, metric: "oklab" }),
    ).toThrow(RangeError);
    expect(() =>
      floydSteinberg(samples, [false], 1.5, 1, palette, index, { strength: 1, metric: "oklab" }),
    ).toThrow(RangeError);
  });

  it("samples 长度必须等于 width*height", () => {
    const palette = makeTwoColorPalette();
    const index = buildPaletteIndex(palette, "oklab");

    expect(() =>
      floydSteinberg(makeGray3x3().slice(0, 8), makeMask(9), 3, 3, palette, index, {
        strength: 1,
        metric: "oklab",
      }),
    ).toThrow(/samples\.length/);
  });

  it("alphaMask 长度必须等于 width*height，元素必须是 boolean", () => {
    const palette = makeTwoColorPalette();
    const index = buildPaletteIndex(palette, "oklab");

    expect(() =>
      floydSteinberg(makeGray3x3(), makeMask(8), 3, 3, palette, index, {
        strength: 1,
        metric: "oklab",
      }),
    ).toThrow(/alphaMask\.length/);

    const notBoolean = [0, false, false, false, false, false, false, false, false];
    expect(() =>
      floydSteinberg(makeGray3x3(), notBoolean as unknown as boolean[], 3, 3, palette, index, {
        strength: 1,
        metric: "oklab",
      }),
    ).toThrow(/alphaMask\[0\]/);
  });

  it("strength 超出 [0,1] 或非有限数时抛错", () => {
    const palette = makeTwoColorPalette();
    const index = buildPaletteIndex(palette, "oklab");
    const samples = makeGray3x3();
    const mask = makeMask(9);

    for (const strength of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        floydSteinberg(samples, mask, 3, 3, palette, index, { strength, metric: "oklab" }),
      ).toThrow(/options\.strength/);
    }
  });

  it("非法 metric 抛错", () => {
    const palette = makeTwoColorPalette();
    const index = buildPaletteIndex(palette, "oklab");
    const options = { strength: 1, metric: "rgb" } as unknown as DitherOptions;

    expect(() => floydSteinberg(makeGray3x3(), makeMask(9), 3, 3, palette, index, options)).toThrow(
      /options\.metric/,
    );
  });

  it("index.size 与 palette.length 不一致时抛错", () => {
    const palette = makeTwoColorPalette();
    const threeColorIndex = buildPaletteIndex([...palette, bead("G", "#808080", "Gray")], "oklab");

    expect(() =>
      floydSteinberg(makeGray3x3(), makeMask(9), 3, 3, palette, threeColorIndex, {
        strength: 1,
        metric: "oklab",
      }),
    ).toThrow(/index\.size/);
  });

  it("非法采样（非有限值或越界）抛错", () => {
    const palette = makeTwoColorPalette();
    const index = buildPaletteIndex(palette, "oklab");

    const bad = [gray(0), { r: 256, g: 0, b: 0 }, ...makeGray3x3().slice(2)];
    expect(() =>
      floydSteinberg(bad, makeMask(9), 3, 3, palette, index, {
        strength: 1,
        metric: "oklab",
      }),
    ).toThrow(RangeError);

    const nan = [gray(0), { r: Number.NaN, g: 0, b: 0 }, ...makeGray3x3().slice(2)];
    expect(() =>
      floydSteinberg(nan, makeMask(9), 3, 3, palette, index, {
        strength: 1,
        metric: "oklab",
      }),
    ).toThrow(RangeError);
  });
});
