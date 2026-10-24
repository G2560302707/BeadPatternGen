import { describe, expect, it } from "vitest";
import { deltaE2000, deltaEOklab, hexToRgb, rgbToLab, rgbToOklab } from "../color";
import type { ColorMetricName, RGB } from "../color";
import { PaletteError, buildPaletteIndex, selectPaletteSubset } from "./index";
import type { BeadColor, PaletteErrorCode } from "./index";

function bead(code: string, hex: string, name: string = code): BeadColor {
  return { code, name, hex, manufacturer: "TEST" };
}

function makeTinyPalette(): BeadColor[] {
  return [
    bead("A", "#000000", "Black"),
    bead("B", "#808080", "Gray"),
    bead("C", "#FFFFFF", "White"),
  ];
}

function makeTenColorPalette(): BeadColor[] {
  return [
    bead("P00", "#000000", "Black"),
    bead("P01", "#FFFFFF", "White"),
    bead("P02", "#FF0000", "Red"),
    bead("P03", "#00FF00", "Green"),
    bead("P04", "#0000FF", "Blue"),
    bead("P05", "#FFFF00", "Yellow"),
    bead("P06", "#FF00FF", "Magenta"),
    bead("P07", "#00FFFF", "Cyan"),
    bead("P08", "#808080", "Gray"),
    bead("P09", "#FF8000", "Orange"),
  ];
}

/**
 * VECTORS.md §3 的样本分布：每项 [hex, 出现次数]。
 * 样本恰好等于色卡色，便于把 coverage 与权重直接对照。
 */
function makeTenColorSamples(): RGB[] {
  const distribution: ReadonlyArray<readonly [string, number]> = [
    ["#000000", 30],
    ["#FFFFFF", 25],
    ["#FF0000", 10],
    ["#00FF00", 10],
    ["#0000FF", 10],
    ["#FFFF00", 3],
    ["#FF00FF", 3],
    ["#00FFFF", 3],
    ["#808080", 2],
    ["#FF8000", 2],
  ];
  const samples: RGB[] = [];
  for (const [hex, count] of distribution) {
    for (let index = 0; index < count; index += 1) {
      samples.push(hexToRgb(hex));
    }
  }
  return samples;
}

function capturePaletteError(action: () => unknown): PaletteError {
  try {
    action();
  } catch (error) {
    if (error instanceof PaletteError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected action to throw PaletteError, but it returned normally");
}

function expectPaletteError(
  action: () => unknown,
  code: PaletteErrorCode,
  messagePart?: string,
): PaletteError {
  const error = capturePaletteError(action);
  expect(error.code).toBe(code);
  if (messagePart !== undefined) {
    expect(error.message).toContain(messagePart);
  }
  return error;
}

describe("buildPaletteIndex / nearest", () => {
  it("3 色 Oklab 最近邻与 VECTORS.md 表 1 一致", () => {
    const index = buildPaletteIndex(makeTinyPalette(), "oklab");

    expect(index.size).toBe(3);

    const cases: ReadonlyArray<readonly [string, number, number]> = [
      // [查询 hex, 期望 index, 期望距离（6 位小数，来自手算）]
      ["#404040", 1, 0.228376],
      ["#202020", 0, 0.243535],
      ["#C0C0C0", 2, 0.192204],
      ["#808080", 1, 0],
    ];

    for (const [hex, expectedIndex, expectedDistance] of cases) {
      const match = index.nearest(hexToRgb(hex));
      expect(match.index).toBe(expectedIndex);
      expect(match.distance).toBeCloseTo(expectedDistance, 6);
    }
  });

  it("candidates 子集限定查询范围", () => {
    const index = buildPaletteIndex(makeTinyPalette(), "oklab");

    const withoutBlack = index.nearest(hexToRgb("#808080"), [0, 2]);
    expect(withoutBlack.index).toBe(2);
    expect(withoutBlack.distance).toBeCloseTo(0.400129, 6);

    const onlyBlack = index.nearest(hexToRgb("#808080"), [0]);
    expect(onlyBlack.index).toBe(0);
    expect(onlyBlack.distance).toBeCloseTo(0.599871, 6);

    // 重复候选不改变结果。
    const duplicated = index.nearest(hexToRgb("#808080"), [2, 2, 0]);
    expect(duplicated.index).toBe(2);
  });

  it("metric 决定色彩空间：同一查询在 CIEDE2000 与 Oklab 下命中不同色卡色", () => {
    const rgb = hexToRgb("#404040");
    const oklabIndex = buildPaletteIndex(makeTinyPalette(), "oklab");
    const ciedeIndex = buildPaletteIndex(makeTinyPalette(), "ciede2000");

    const oklabMatch = oklabIndex.nearest(rgb);
    expect(oklabMatch.index).toBe(1);
    expect(oklabMatch.distance).toBeCloseTo(0.228376, 6);

    // CIEDE2000 的 S_L 在 L≈50 附近权重更大，因此 #404040 判给黑色。
    const ciedeMatch = ciedeIndex.nearest(rgb);
    expect(ciedeMatch.index).toBe(0);
    expect(ciedeMatch.distance).toBeCloseTo(17.56199, 5);
  });

  it("距离计算与 S04 原语逐字节一致（缓存未改变数值）", () => {
    const rgb = hexToRgb("#404040");

    const oklabMatch = buildPaletteIndex(makeTinyPalette(), "oklab").nearest(rgb);
    const expectedOklab = deltaEOklab(rgbToOklab(rgb), rgbToOklab(hexToRgb("#808080")));
    expect(oklabMatch.distance).toBe(expectedOklab);

    const ciedeMatch = buildPaletteIndex(makeTinyPalette(), "ciede2000").nearest(rgb);
    const expectedCiede = deltaE2000(rgbToLab(rgb), rgbToLab(hexToRgb("#000000")));
    expect(ciedeMatch.distance).toBe(expectedCiede);
  });

  it("平局取较小 index：全表扫描与乱序 candidates 都成立", () => {
    // index 0 与 index 2 是同一实测色的两种 hex 写法（#RRGGBB / #RGB），
    // 到同一查询的距离逐位相等。
    const palette = [bead("A", "#000000"), bead("B", "#808080"), bead("C", "#000")];
    const index = buildPaletteIndex(palette, "oklab");
    // #101010 明显更接近黑色；index 0 与 2 都是黑色，构成精确平局。
    const query = hexToRgb("#101010");

    const forward = index.nearest(query);
    expect(forward.index).toBe(0);

    // 候选顺序反转后，平局仍必须落到更小 index，而不是“先到先得”。
    const reversed = index.nearest(query, [2, 0]);
    expect(reversed.index).toBe(0);
    expect(reversed.distance).toBe(forward.distance);

    // 只给 index 2 时当然返回 2，证明两条记录都存在且距离相等。
    const onlyLate = index.nearest(query, [2]);
    expect(onlyLate.index).toBe(2);
    expect(onlyLate.distance).toBe(forward.distance);
  });

  it("允许不同 code 使用相同 hex（只禁止重复 code）", () => {
    const palette = [bead("A", "#123456"), bead("B", "#123456")];
    const index = buildPaletteIndex(palette, "ciede2000");
    expect(index.size).toBe(2);
    expect(index.nearest(hexToRgb("#123456")).index).toBe(0);
  });

  it("重复调用结果完全一致，且不修改入参色卡", () => {
    const palette = makeTenColorPalette();
    const snapshot = JSON.stringify(palette);
    const index = buildPaletteIndex(palette, "oklab");
    const query = hexToRgb("#3C7A9E");

    const first = index.nearest(query);
    const second = index.nearest(query);
    const third = index.nearest(query, [0, 2, 4, 6, 8]);

    expect(second).toEqual(first);
    expect(index.nearest(query)).toEqual(first);
    expect(third.index).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(palette)).toBe(snapshot);
  });
});

describe("buildPaletteIndex 输入校验", () => {
  it("空色卡抛 EMPTY_PALETTE", () => {
    expectPaletteError(() => buildPaletteIndex([], "oklab"), "EMPTY_PALETTE");
  });

  it("非法 hex 抛 INVALID_HEX，消息带 code 与原 hex", () => {
    const error = expectPaletteError(
      () => buildPaletteIndex([bead("BAD-1", "#GGG")], "oklab"),
      "INVALID_HEX",
      "BAD-1",
    );
    expect(error.message).toContain("#GGG");
  });

  it("重复 code 抛 DUPLICATE_CODE，消息带重复 code 与两个下标", () => {
    const error = expectPaletteError(
      () => buildPaletteIndex([bead("S01", "#000000"), bead("S01", "#FFFFFF")], "oklab"),
      "DUPLICATE_CODE",
      "S01",
    );
    expect(error.message).toContain("0");
    expect(error.message).toContain("1");
  });

  it("字段类型错误抛 INVALID_PALETTE_ENTRY", () => {
    const broken = { code: "A", name: "A", hex: "#000000" } as unknown as BeadColor;
    expectPaletteError(
      () => buildPaletteIndex([broken], "oklab"),
      "INVALID_PALETTE_ENTRY",
      "manufacturer",
    );

    const notAnObject = null as unknown as BeadColor;
    expectPaletteError(
      () => buildPaletteIndex([notAnObject], "oklab"),
      "INVALID_PALETTE_ENTRY",
      "palette[0]",
    );
  });

  it("非法 metric 抛 INVALID_METRIC", () => {
    expectPaletteError(
      () => buildPaletteIndex(makeTinyPalette(), "rgb" as ColorMetricName),
      "INVALID_METRIC",
      "rgb",
    );
  });

  it("nearest 的非法查询色抛 INVALID_SAMPLE", () => {
    const index = buildPaletteIndex(makeTinyPalette(), "oklab");
    expectPaletteError(
      () => index.nearest({ r: -1, g: 0, b: 0 }),
      "INVALID_SAMPLE",
      "nearest(color).r",
    );
    expectPaletteError(
      () => index.nearest({ r: 0, g: Number.NaN, b: 0 }),
      "INVALID_SAMPLE",
      "nearest(color).g",
    );
    expectPaletteError(
      () => index.nearest({ r: 0, g: 0, b: 256 }),
      "INVALID_SAMPLE",
      "nearest(color).b",
    );
  });

  it("空 candidates 抛 INVALID_CANDIDATES", () => {
    const index = buildPaletteIndex(makeTinyPalette(), "oklab");
    expectPaletteError(() => index.nearest(hexToRgb("#404040"), []), "INVALID_CANDIDATES");
  });

  it("非法 candidates 抛 INVALID_CANDIDATE_INDEX（即使非法项在合法项之后）", () => {
    const index = buildPaletteIndex(makeTinyPalette(), "oklab");

    expectPaletteError(
      () => index.nearest(hexToRgb("#404040"), [0, 3]),
      "INVALID_CANDIDATE_INDEX",
      "candidates[1]",
    );
    expectPaletteError(
      () => index.nearest(hexToRgb("#404040"), [1.5]),
      "INVALID_CANDIDATE_INDEX",
      "1.5",
    );
    expectPaletteError(
      () => index.nearest(hexToRgb("#404040"), [-1]),
      "INVALID_CANDIDATE_INDEX",
      "-1",
    );
    expectPaletteError(
      () => index.nearest(hexToRgb("#404040"), [Number.NaN]),
      "INVALID_CANDIDATE_INDEX",
      "NaN",
    );
  });
});

describe("selectPaletteSubset", () => {
  it("10 色色卡 + VECTORS.md §3 分布 + maxColors=4 输出 [0,1,2,4]", () => {
    const result = selectPaletteSubset(makeTenColorSamples(), makeTenColorPalette(), 4, "oklab");
    expect(result).toEqual([0, 1, 2, 4]);
  });

  it("结果严格 ⊆ palette，升序、无重复、长度 = min(maxColors, palette.length)", () => {
    const palette = makeTenColorPalette();
    const result = selectPaletteSubset(makeTenColorSamples(), palette, 4, "ciede2000");

    expect(result).toHaveLength(4);
    for (const index of result) {
      expect(Number.isInteger(index)).toBe(true);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(palette.length);
    }
    expect(new Set(result).size).toBe(result.length);
    expect([...result].sort((a, b) => a - b)).toEqual(result);
  });

  it("maxColors >= palette.length 时返回全部索引（升序）", () => {
    const palette = makeTenColorPalette();
    const samples = makeTenColorSamples();
    const all = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

    expect(selectPaletteSubset(samples, palette, 10, "oklab")).toEqual(all);
    expect(selectPaletteSubset(samples, palette, 99, "oklab")).toEqual(all);
  });

  it("maxColors=1 时返回覆盖权重最大的色卡色", () => {
    expect(selectPaletteSubset(makeTenColorSamples(), makeTenColorPalette(), 1, "oklab")).toEqual([
      0,
    ]);
  });

  it("样本顺序不影响结果（折叠后按 RGB 全序排序）", () => {
    const palette = makeTenColorPalette();
    const samples = makeTenColorSamples();
    const reversed = [...samples].reverse();
    const rotated = [...samples.slice(40), ...samples.slice(0, 40)];

    const expected = selectPaletteSubset(samples, palette, 4, "oklab");
    expect(selectPaletteSubset(reversed, palette, 4, "oklab")).toEqual(expected);
    expect(selectPaletteSubset(rotated, palette, 4, "oklab")).toEqual(expected);
  });

  it("重复次数整体缩放不改变选择（权重按出现次数累加）", () => {
    const palette = makeTenColorPalette();
    const samples = makeTenColorSamples();
    const tripled = samples.flatMap((sample) => [sample, sample, sample]);

    expect(selectPaletteSubset(tripled, palette, 4, "oklab")).toEqual(
      selectPaletteSubset(samples, palette, 4, "oklab"),
    );
  });

  it("同输入连续调用两次结果完全一致，且不修改入参", () => {
    const palette = makeTenColorPalette();
    const samples = makeTenColorSamples();
    const paletteSnapshot = JSON.stringify(palette);
    const samplesSnapshot = JSON.stringify(samples);

    const first = selectPaletteSubset(samples, palette, 4, "ciede2000");
    const second = selectPaletteSubset(samples, palette, 4, "ciede2000");

    expect(second).toEqual(first);
    expect(JSON.stringify(palette)).toBe(paletteSnapshot);
    expect(JSON.stringify(samples)).toBe(samplesSnapshot);
  });

  it("所有样本同色时，剩余名额按最小未选 index 确定性地补齐", () => {
    const palette = makeTenColorPalette();
    const samples: RGB[] = [];
    for (let index = 0; index < 5; index += 1) {
      samples.push(hexToRgb("#808080"));
    }

    // 覆盖最大的是 P08；其余得分全为 0，按 0、1 顺序补足到 3 个。
    expect(selectPaletteSubset(samples, palette, 3, "oklab")).toEqual([0, 1, 8]);
  });

  it("maxColors <= 0 或非整数抛 INVALID_MAX_COLORS", () => {
    const palette = makeTenColorPalette();
    const samples = makeTenColorSamples();

    for (const bad of [0, -1, -100, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expectPaletteError(
        () => selectPaletteSubset(samples, palette, bad, "oklab"),
        "INVALID_MAX_COLORS",
        String(bad),
      );
    }
  });

  it("空样本抛 EMPTY_SAMPLES（即使 maxColors 已覆盖整张色卡）", () => {
    expectPaletteError(
      () => selectPaletteSubset([], makeTenColorPalette(), 10, "oklab"),
      "EMPTY_SAMPLES",
    );
  });

  it("空色卡抛 EMPTY_PALETTE", () => {
    expectPaletteError(
      () => selectPaletteSubset(makeTenColorSamples(), [], 4, "oklab"),
      "EMPTY_PALETTE",
    );
  });

  it("非法样本抛 INVALID_SAMPLE，消息带样本下标与通道", () => {
    const palette = makeTenColorPalette();
    const samples: RGB[] = [hexToRgb("#000000"), { r: 0, g: 256, b: 0 }];

    expectPaletteError(
      () => selectPaletteSubset(samples, palette, 4, "oklab"),
      "INVALID_SAMPLE",
      "samples[1].g",
    );
  });

  it("非法 metric 抛 INVALID_METRIC", () => {
    expectPaletteError(
      () =>
        selectPaletteSubset(
          makeTenColorSamples(),
          makeTenColorPalette(),
          4,
          "lab" as ColorMetricName,
        ),
      "INVALID_METRIC",
      "lab",
    );
  });

  it("校验顺序固定：maxColors 优先于色卡与样本", () => {
    expectPaletteError(() => selectPaletteSubset([], [], 0, "oklab"), "INVALID_MAX_COLORS");
  });
});
