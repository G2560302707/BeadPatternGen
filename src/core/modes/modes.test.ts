import { describe, expect, it } from "vitest";
import { deltaE2000, deltaEOklab, hexToRgb, rgbToLab, rgbToOklab } from "../color";
import type { ColorMetricName } from "../color";
import { buildPaletteIndex } from "../palette";
import type { BeadColor, PaletteIndex } from "../palette";
import { getModeProfile, refineLocally, scoreCandidate } from "./index";
import type { CandidateScoreTerms, ImageMode, ModeProfile, RefineOptions } from "./index";

/**
 * 测试约定：
 * - 所有断言都只依赖本文件显式构造的色卡与格子，不读取外部 fixture；
 * - 阈值用运行时算出的真实 ΔE 表达（d/2、d*2），避免把度量实现复制进测试；
 * - 需要“一定会改色”的场景使用 aggressiveProfile：孤立惩罚 200、合并阈值 200，
 *   远大于白/黑之间的 ΔE（约 100），因此判定不受浮点末位影响。
 */

function bead(code: string, hex: string): BeadColor {
  return { code, name: code, hex, manufacturer: "TEST" };
}

/** 6 级灰度，任意两色 ΔE 都远小于 200。 */
function grayscalePalette(): BeadColor[] {
  return [
    bead("G0", "#101010"),
    bead("G1", "#303030"),
    bead("G2", "#505050"),
    bead("G3", "#707070"),
    bead("G4", "#909090"),
    bead("G5", "#B0B0B0"),
  ];
}

/**
 * 黑 + 白 + 5 个接近白的高光灰。
 * 从白色 (index 1) 出发，最近的 5 个色卡是这些灰，黑色排在第 6；
 * 因此 neighborCandidateCount=3 时黑色不在候选集里，=8 时黑色一定在。
 */
function blackWhitePalette(): BeadColor[] {
  return [
    bead("K", "#000000"),
    bead("W", "#FFFFFF"),
    bead("S0", "#F0F0F0"),
    bead("S1", "#E0E0E0"),
    bead("S2", "#D0D0D0"),
    bead("S3", "#C0C0C0"),
    bead("S4", "#B0B0B0"),
  ];
}

function deltaE(metric: ColorMetricName, firstHex: string, secondHex: string): number {
  const first = hexToRgb(firstHex);
  const second = hexToRgb(secondHex);
  return metric === "ciede2000"
    ? deltaE2000(rgbToLab(first), rgbToLab(second))
    : deltaEOklab(rgbToOklab(first), rgbToOklab(second));
}

function aggressiveProfile(overrides: Partial<ModeProfile> = {}): ModeProfile {
  return {
    defaultDithering: "none",
    allowUserDithering: true,
    edgeProtectWeight: 0,
    isolatedPenalty: 200,
    colorMergeThreshold: 200,
    localRefinePasses: 3,
    neighborCandidateCount: 8,
    ...overrides,
  };
}

interface BaseOptions {
  readonly width: number;
  readonly height: number;
  readonly cells: Int16Array;
  readonly palette: readonly BeadColor[];
  readonly metric?: ColorMetricName;
  readonly perCellDelta?: Float32Array;
  readonly edgeStrength?: Float32Array;
  readonly profile?: ModeProfile;
  readonly index?: PaletteIndex;
}

function makeOptions(base: BaseOptions): RefineOptions {
  const metric = base.metric ?? "ciede2000";
  const cellCount = base.width * base.height;
  return {
    width: base.width,
    height: base.height,
    cells: base.cells,
    palette: base.palette,
    index: base.index ?? buildPaletteIndex(base.palette, metric),
    metric,
    perCellDelta: base.perCellDelta ?? new Float32Array(cellCount),
    edgeStrength: base.edgeStrength ?? new Float32Array(cellCount),
    profile: { ...(base.profile ?? getModeProfile("photo")) },
  };
}

/** 3×3：外圈全黑，中心白。中心是唯一的孤立格。 */
function blackRingWithWhiteCenter(): Int16Array {
  return new Int16Array([0, 0, 0, 0, 1, 0, 0, 0, 0]);
}

/** 3×3：中心白，其余全黑；返回中心下标。 */
const CENTER = 4;

function runAggressive(
  profileOverrides: Partial<ModeProfile> = {},
  extras: Partial<BaseOptions> = {},
): Int16Array {
  const palette = blackWhitePalette();
  return refineLocally(
    makeOptions({
      width: 3,
      height: 3,
      cells: blackRingWithWhiteCenter(),
      palette,
      profile: aggressiveProfile(profileOverrides),
      ...extras,
    }),
  );
}

describe("getModeProfile · 规格 4.4 默认表", () => {
  const expected: Record<ImageMode, ModeProfile> = {
    photo: {
      defaultDithering: "none",
      allowUserDithering: true,
      edgeProtectWeight: 3,
      isolatedPenalty: 6,
      colorMergeThreshold: 5,
      localRefinePasses: 2,
      neighborCandidateCount: 8,
    },
    anime: {
      defaultDithering: "none",
      allowUserDithering: false,
      edgeProtectWeight: 6,
      isolatedPenalty: 5,
      colorMergeThreshold: 4,
      localRefinePasses: 3,
      neighborCandidateCount: 8,
    },
    logo: {
      defaultDithering: "none",
      allowUserDithering: false,
      edgeProtectWeight: 8,
      isolatedPenalty: 3,
      colorMergeThreshold: 2,
      localRefinePasses: 2,
      neighborCandidateCount: 8,
    },
    landscape: {
      defaultDithering: "none",
      allowUserDithering: true,
      edgeProtectWeight: 2.5,
      isolatedPenalty: 8,
      colorMergeThreshold: 6,
      localRefinePasses: 3,
      neighborCandidateCount: 8,
    },
  };

  it("四种模式的每个字段都与规格表逐条一致", () => {
    for (const mode of ["photo", "anime", "logo", "landscape"] as const) {
      expect(getModeProfile(mode)).toEqual(expected[mode]);
    }
  });

  it("默认抖动一律 none；仅 photo / landscape 允许用户开启", () => {
    for (const mode of ["photo", "anime", "logo", "landscape"] as const) {
      const profile = getModeProfile(mode);
      expect(profile.defaultDithering).toBe("none");
      expect(profile.allowUserDithering).toBe(mode === "photo" || mode === "landscape");
    }
  });

  it("默认 profile 是冻结对象，未知模式抛 RangeError", () => {
    expect(Object.isFrozen(getModeProfile("photo"))).toBe(true);
    expect(() => getModeProfile("sketch" as unknown as ImageMode)).toThrow(RangeError);
  });
});

describe("scoreCandidate · 目标函数公式", () => {
  it("孤立且改色的格子 = 色差 + 孤立惩罚 + 边缘权重 × 边缘强度", () => {
    const terms: CandidateScoreTerms = {
      colorDelta: 2,
      causesIsolation: true,
      edgeRecolor: true,
      edgeStrength: 0.5,
      isolatedPenalty: 5,
      edgeProtectWeight: 3,
    };
    expect(scoreCandidate(terms)).toBe(2 + 5 + 1.5);
  });

  it("非孤立、未改色时不加任何惩罚项", () => {
    expect(
      scoreCandidate({
        colorDelta: 7.25,
        causesIsolation: false,
        edgeRecolor: false,
        edgeStrength: 1,
        isolatedPenalty: 100,
        edgeProtectWeight: 100,
      }),
    ).toBe(7.25);
  });

  it("所有权重为 0 时只剩色差项", () => {
    expect(
      scoreCandidate({
        colorDelta: 12.5,
        causesIsolation: true,
        edgeRecolor: true,
        edgeStrength: 1,
        isolatedPenalty: 0,
        edgeProtectWeight: 0,
      }),
    ).toBe(12.5);
  });
});

describe("refineLocally · 权重全零与入参不可变", () => {
  it("isolatedPenalty=0 且 edgeProtectWeight=0 时逐格严格等于输入", () => {
    const palette = blackWhitePalette();
    const cells = blackRingWithWhiteCenter();
    const before = new Int16Array(cells);
    const result = refineLocally(
      makeOptions({
        width: 3,
        height: 3,
        cells,
        palette,
        profile: aggressiveProfile({
          isolatedPenalty: 0,
          edgeProtectWeight: 0,
          colorMergeThreshold: 200,
          localRefinePasses: 5,
        }),
      }),
    );

    expect(result).not.toBe(cells);
    expect(Array.from(result)).toEqual(Array.from(before));
    expect(Array.from(cells)).toEqual(Array.from(before));
  });

  it("localRefinePasses=0 时完全不做优化，并返回新数组", () => {
    const palette = blackWhitePalette();
    const cells = new Int16Array([0, 1, 0, 1, 0, 1, 0, 1, 0]);
    const result = refineLocally(
      makeOptions({
        width: 3,
        height: 3,
        cells,
        palette,
        profile: aggressiveProfile({ localRefinePasses: 0 }),
      }),
    );

    expect(result).not.toBe(cells);
    expect(Array.from(result)).toEqual(Array.from(cells));
  });

  it("发生改色时不修改入参 cells", () => {
    const palette = blackWhitePalette();
    const cells = blackRingWithWhiteCenter();
    const before = new Int16Array(cells);
    const result = refineLocally(
      makeOptions({
        width: 3,
        height: 3,
        cells,
        palette,
        profile: aggressiveProfile(),
      }),
    );

    expect(result[CENTER]).toBe(0);
    expect(cells[CENTER]).toBe(1);
    expect(Array.from(cells)).toEqual(Array.from(before));
  });
});

describe("refineLocally · 孤立点修复与参数可观察效果", () => {
  it("孤立中心在惩罚足够大时合并到唯一邻色", () => {
    const result = runAggressive();
    expect(result[CENTER]).toBe(0);
    // 其它格子本来就不是孤立格，不应改动。
    for (let index = 0; index < 9; index += 1) {
      if (index !== CENTER) {
        expect(result[index]).toBe(0);
      }
    }
  });

  it("edgeProtectWeight × edgeStrength 能阻止边缘格改色", () => {
    const palette = blackWhitePalette();
    const edgeStrength = new Float32Array(9);
    edgeStrength[CENTER] = 1;

    const protectedResult = refineLocally(
      makeOptions({
        width: 3,
        height: 3,
        cells: blackRingWithWhiteCenter(),
        palette,
        edgeStrength,
        profile: aggressiveProfile({ edgeProtectWeight: 300 }),
      }),
    );
    expect(protectedResult[CENTER]).toBe(1);

    // 同样的权重，但 edgeStrength=0：边缘惩罚为 0，仍会合并。
    const unprotectedResult = refineLocally(
      makeOptions({
        width: 3,
        height: 3,
        cells: blackRingWithWhiteCenter(),
        palette,
        edgeStrength: new Float32Array(9),
        profile: aggressiveProfile({ edgeProtectWeight: 300 }),
      }),
    );
    expect(unprotectedResult[CENTER]).toBe(0);
  });

  it("colorMergeThreshold 是严格小于门槛：低于黑白色差时不允许合并", () => {
    const d = deltaE("ciede2000", "#000000", "#FFFFFF");
    expect(d).toBeGreaterThan(0);

    const blocked = runAggressive({ colorMergeThreshold: d / 2 });
    expect(blocked[CENTER]).toBe(1);

    const allowed = runAggressive({ colorMergeThreshold: d * 2 });
    expect(allowed[CENTER]).toBe(0);
  });

  it("neighborCandidateCount 决定当前色的邻近候选集大小", () => {
    // 黑色是白色第 6 近的色卡；N=3 时不在候选集，N=8 时在。
    const tooNarrow = runAggressive({ neighborCandidateCount: 3 });
    expect(tooNarrow[CENTER]).toBe(1);

    const wideEnough = runAggressive({ neighborCandidateCount: 8 });
    expect(wideEnough[CENTER]).toBe(0);
  });

  it("perCellDelta=0 不是门槛，孤立点仍可被修复", () => {
    // 全部为 0 的 perCellDelta 不应阻止优化；色差上界中的该项会抵消。
    const perCellDelta = new Float32Array(9);
    const result = runAggressive({}, { perCellDelta });
    expect(result[CENTER]).toBe(0);
  });

  it("perCellDelta 整体平移不改变候选比较结果", () => {
    const perCellDelta = new Float32Array(9).fill(50);
    const result = runAggressive({}, { perCellDelta });
    expect(result[CENTER]).toBe(0);
  });
});

describe("refineLocally · 确定性与幂等", () => {
  it("相同输入重复调用得到逐格相同的输出", () => {
    const options = makeOptions({
      width: 3,
      height: 3,
      cells: blackRingWithWhiteCenter(),
      palette: blackWhitePalette(),
      profile: aggressiveProfile(),
    });
    const first = refineLocally(options);
    const second = refineLocally(options);
    expect(Array.from(first)).toEqual(Array.from(second));
  });

  it("四种模式（放大权重后）第二次调用都不再变化", () => {
    for (const mode of ["photo", "anime", "logo", "landscape"] as const) {
      const profile: ModeProfile = {
        ...getModeProfile(mode),
        edgeProtectWeight: 0,
        isolatedPenalty: 200,
        colorMergeThreshold: 200,
        neighborCandidateCount: 8,
        localRefinePasses: 1,
      };
      const options = makeOptions({
        width: 3,
        height: 3,
        cells: blackRingWithWhiteCenter(),
        palette: blackWhitePalette(),
        profile,
      });
      const first = refineLocally(options);
      const second = refineLocally({ ...options, cells: first });
      expect(Array.from(second)).toEqual(Array.from(first));
    }
  });

  it("1 轮扫描不足以传播完的长链，仍由稳定化阶段保证不动点", () => {
    const palette = grayscalePalette();
    const cells = new Int16Array([0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5]);
    const before = new Int16Array(cells);
    const options = makeOptions({
      width: 12,
      height: 1,
      cells,
      palette,
      profile: aggressiveProfile({ localRefinePasses: 1 }),
    });

    const first = refineLocally(options);
    // 确认这不是“什么都没做”的假幂等。
    expect(Array.from(first)).not.toEqual(Array.from(before));

    const second = refineLocally({ ...options, cells: first });
    expect(Array.from(second)).toEqual(Array.from(first));
    expect(Array.from(cells)).toEqual(Array.from(before));
  });

  it("oklab 度量同样满足幂等与候选合法性", () => {
    const palette = blackWhitePalette();
    const options = makeOptions({
      width: 3,
      height: 3,
      cells: blackRingWithWhiteCenter(),
      palette,
      metric: "oklab",
      profile: aggressiveProfile({
        // Oklab 距离量级为 0–1，按同量级设置阈值与惩罚。
        colorMergeThreshold: 5,
        isolatedPenalty: 6,
        edgeProtectWeight: 0,
        localRefinePasses: 2,
      }),
    });

    const first = refineLocally(options);
    expect(first[CENTER]).toBe(0);
    for (const value of first) {
      expect(value === -1 || (value >= 0 && value < palette.length)).toBe(true);
    }

    const second = refineLocally({ ...options, cells: first });
    expect(Array.from(second)).toEqual(Array.from(first));
  });
});

describe("refineLocally · 空格与邻域语义", () => {
  it("空格永远保持 -1，不会被候选色填充", () => {
    const palette = blackWhitePalette();
    const cells = new Int16Array([-1, -1, -1, -1, 0, -1, -1, -1, -1]);
    const result = refineLocally(
      makeOptions({
        width: 3,
        height: 3,
        cells,
        palette,
        profile: aggressiveProfile(),
      }),
    );

    expect(Array.from(result)).toEqual(Array.from(cells));
  });

  it("只有空格邻居的孤立格无法修复；有彩色邻居时可以修复", () => {
    const palette = blackWhitePalette();

    const onlyEmptyNeighbors = new Int16Array([-1, -1, -1, -1, 1, -1, -1, -1, -1]);
    const noFix = refineLocally(
      makeOptions({
        width: 3,
        height: 3,
        cells: onlyEmptyNeighbors,
        palette,
        profile: aggressiveProfile(),
      }),
    );
    expect(noFix[CENTER]).toBe(1);

    const oneColoredNeighbor = new Int16Array([-1, -1, -1, -1, 1, 0, -1, -1, -1]);
    const fixed = refineLocally(
      makeOptions({
        width: 3,
        height: 3,
        cells: oneColoredNeighbor,
        palette,
        profile: aggressiveProfile(),
      }),
    );
    expect(fixed[CENTER]).toBe(0);
    // 空格保持空格。
    expect(fixed[0]).toBe(-1);
    expect(fixed[3]).toBe(-1);
    // index 5 是提供邻色的非空格，必须原样保留。
    expect(fixed[5]).toBe(0);
  });

  it("相邻同色格不算孤立，因此不会被无谓改色", () => {
    const palette = grayscalePalette();
    const cells = new Int16Array([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const result = refineLocally(
      makeOptions({
        width: 3,
        height: 3,
        cells,
        palette,
        profile: aggressiveProfile({ localRefinePasses: 3 }),
      }),
    );
    expect(Array.from(result)).toEqual(Array.from(cells));
  });
});

describe("refineLocally · 输入校验", () => {
  function validOptions(): RefineOptions {
    return makeOptions({
      width: 3,
      height: 3,
      cells: blackRingWithWhiteCenter(),
      palette: blackWhitePalette(),
      profile: aggressiveProfile(),
    });
  }

  it("非法尺寸 / 数组长度 / 数组类型抛 RangeError", () => {
    const options = validOptions();
    expect(() => refineLocally({ ...options, width: 0 })).toThrow(RangeError);
    expect(() => refineLocally({ ...options, height: -1 })).toThrow(RangeError);
    expect(() => refineLocally({ ...options, cells: new Int16Array(8) })).toThrow(RangeError);
    expect(() => refineLocally({ ...options, perCellDelta: new Float32Array(8) })).toThrow(
      RangeError,
    );
    expect(() => refineLocally({ ...options, edgeStrength: new Float32Array(8) })).toThrow(
      RangeError,
    );
    expect(() =>
      refineLocally({ ...options, cells: [0, 0, 0, 0, 1, 0, 0, 0, 0] as unknown as Int16Array }),
    ).toThrow(RangeError);
    expect(() =>
      refineLocally({
        ...options,
        perCellDelta: [0, 0, 0, 0, 0, 0, 0, 0, 0] as unknown as Float32Array,
      }),
    ).toThrow(RangeError);
  });

  it("非法 cell 下标 / perCellDelta / edgeStrength 抛 RangeError", () => {
    const options = validOptions();
    expect(() =>
      refineLocally({ ...options, cells: new Int16Array([0, 0, 0, 0, 7, 0, 0, 0, 0]) }),
    ).toThrow(RangeError);
    expect(() =>
      refineLocally({ ...options, cells: new Int16Array([0, 0, 0, 0, -2, 0, 0, 0, 0]) }),
    ).toThrow(RangeError);

    const negativeDelta = new Float32Array(9);
    negativeDelta[CENTER] = -1;
    expect(() => refineLocally({ ...options, perCellDelta: negativeDelta })).toThrow(RangeError);

    const nanDelta = new Float32Array(9);
    nanDelta[CENTER] = Number.NaN;
    expect(() => refineLocally({ ...options, perCellDelta: nanDelta })).toThrow(RangeError);

    const tooStrongEdge = new Float32Array(9);
    tooStrongEdge[CENTER] = 1.5;
    expect(() => refineLocally({ ...options, edgeStrength: tooStrongEdge })).toThrow(RangeError);

    const negativeEdge = new Float32Array(9);
    negativeEdge[CENTER] = -0.1;
    expect(() => refineLocally({ ...options, edgeStrength: negativeEdge })).toThrow(RangeError);
  });

  it("非法 palette / index / metric / profile 抛 RangeError", () => {
    const options = validOptions();

    expect(() => refineLocally({ ...options, palette: [] })).toThrow(RangeError);
    expect(() =>
      refineLocally({
        ...options,
        index: buildPaletteIndex(blackWhitePalette().slice(0, 6), "ciede2000"),
      }),
    ).toThrow(RangeError);
    expect(() =>
      refineLocally({ ...options, metric: "lab" as unknown as ColorMetricName }),
    ).toThrow(RangeError);

    expect(() =>
      refineLocally({ ...options, profile: aggressiveProfile({ neighborCandidateCount: 0 }) }),
    ).toThrow(RangeError);
    expect(() =>
      refineLocally({ ...options, profile: aggressiveProfile({ localRefinePasses: -1 }) }),
    ).toThrow(RangeError);
    expect(() =>
      refineLocally({ ...options, profile: aggressiveProfile({ isolatedPenalty: -1 }) }),
    ).toThrow(RangeError);
    expect(() =>
      refineLocally({
        ...options,
        profile: aggressiveProfile({ colorMergeThreshold: Number.NaN }),
      }),
    ).toThrow(RangeError);
    expect(() => refineLocally({ ...options, profile: null as unknown as ModeProfile })).toThrow(
      RangeError,
    );
  });

  it("非法 hex 在解析色卡时抛 RangeError", () => {
    const badPalette = [bead("BAD", "#GGGGGG")];
    const fakeIndex: PaletteIndex = {
      size: 1,
      nearest: () => ({ index: 0, distance: 0 }),
    };
    const options: RefineOptions = {
      width: 1,
      height: 1,
      cells: new Int16Array([0]),
      palette: badPalette,
      index: fakeIndex,
      metric: "ciede2000",
      perCellDelta: new Float32Array(1),
      edgeStrength: new Float32Array(1),
      profile: aggressiveProfile(),
    };
    expect(() => refineLocally(options)).toThrow(RangeError);
  });

  it("options 为 null 时抛 RangeError", () => {
    expect(() => refineLocally(null as unknown as RefineOptions)).toThrow(RangeError);
  });
});
