/**
 * C5 · Alpha 与颜色量化专项回归测试。
 *
 * 验收红线：**透明像素不得被映射为黑色拼豆**。
 *
 * 两种模式：
 * - empty：alpha < 128 的格子是空格（-1），不消耗豆子、不参与误差扩散，
 *   其 RGB 无论是什么（包括透明哨兵 0,0,0）都不能影响输出；
 * - background：alpha = 0 的格子替换为背景色（默认 #FFFFFF）后量化，
 *   保证构图结果的透明背景不会变成黑豆。
 *
 * 这些用例是长期回归红线，改动 pipeline / 采样 / 抖动 / 优化时必须保持通过。
 */

import { describe, expect, it } from "vitest";
import { composeImage } from "../composition";
import type { RgbaImage } from "../composition";
import type { BeadColor } from "../pattern";
import { sampleToGrid } from "../sampling";
import type { BBox, CompositionParams, SubjectMask } from "../subject";
import { PipelineError } from "./errors";
import { generatePattern } from "./generate";
import type { GenerateInput } from "./generate";

const PALETTE: BeadColor[] = [
  { code: "W", name: "White", hex: "#FFFFFF", manufacturer: "Test" },
  { code: "K", name: "Black", hex: "#000000", manufacturer: "Test" },
  { code: "R", name: "Red", hex: "#FF0000", manufacturer: "Test" },
  { code: "G", name: "Green", hex: "#00FF00", manufacturer: "Test" },
  { code: "B", name: "Blue", hex: "#0000FF", manufacturer: "Test" },
];

const WHITE_INDEX = 0;
const BLACK_INDEX = 1;
const RED_INDEX = 2;

type Painter = (x: number, y: number) => [number, number, number, number];

function fillGrid(width: number, height: number, painter: Painter) {
  const rgb = new Uint8ClampedArray(width * height * 3);
  const alpha = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = painter(x, y);
      const index = y * width + x;
      rgb[index * 3] = r;
      rgb[index * 3 + 1] = g;
      rgb[index * 3 + 2] = b;
      alpha[index] = a;
    }
  }
  return { rgb, alpha };
}

function makeInput(
  width: number,
  height: number,
  painter: Painter,
  overrides: Partial<GenerateInput> = {},
): GenerateInput {
  const { rgb, alpha } = fillGrid(width, height, painter);
  return {
    rgb,
    alpha,
    width,
    height,
    palette: PALETTE,
    paletteId: "test-palette",
    paletteVersion: "1.0",
    maxColors: PALETTE.length,
    mode: "photo",
    dithering: "none",
    colorMetric: "ciede2000",
    transparentPolicy: "empty",
    ditherStrength: 1,
    source: { originalWidth: width, originalHeight: height, aspectRatio: width / height },
    title: "alpha-fixture",
    id: "alpha-fixture",
    now: "2026-10-24T00:00:00.000Z",
    ...overrides,
  };
}

/** 用真实的采样结果构造 GenerateInput（用于 C3 构图 → 采样 → 量化的链路测试）。 */
function makeInputFromSample(
  sampled: { rgb: Uint8ClampedArray; alpha: Uint8Array },
  width: number,
  height: number,
  overrides: Partial<GenerateInput> = {},
): GenerateInput {
  return makeInput(width, height, () => [0, 0, 0, 0], {
    rgb: sampled.rgb,
    alpha: sampled.alpha,
    ...overrides,
  });
}

function expectPipelineCode(run: () => unknown, code: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(PipelineError);
    expect((error as PipelineError).code).toBe(code);
    return;
  }
  throw new Error(`expected PipelineError with code ${code}`);
}

describe("empty policy: transparency is preserved", () => {
  it("turns a fully transparent image into a valid zero-bead pattern", () => {
    const result = generatePattern(makeInput(3, 3, () => [0, 0, 0, 0]));

    expect(Array.from(result.pattern.cells)).toEqual(new Array(9).fill(-1));
    expect(result.stats.beadCount).toBe(0);
    expect(result.stats.colorCount).toBe(0);
    expect(result.diagnostic.nonEmptyCells).toBe(0);
    expect(result.pattern.settings.transparentPolicy).toBe("empty");
  });

  it("never lets the transparent RGB sentinel influence matching or dithering", () => {
    // 深色主体 + 透明区域。透明格的 RGB 分别是 (0,0,0) 与洋红；
    // empty 策略下两者都必须被完全忽略，输出逐格一致。
    const blackSentinel = makeInput(
      4,
      2,
      (x) => (x === 0 ? [26, 26, 26, 255] : x === 1 ? [120, 120, 120, 255] : [0, 0, 0, 0]),
      { dithering: "floyd-steinberg" },
    );
    const magentaSentinel = makeInput(
      4,
      2,
      (x) => (x === 0 ? [26, 26, 26, 255] : x === 1 ? [120, 120, 120, 255] : [255, 0, 255, 0]),
      { dithering: "floyd-steinberg" },
    );

    const fromBlack = generatePattern(blackSentinel);
    const fromMagenta = generatePattern(magentaSentinel);

    expect(Array.from(fromBlack.pattern.cells)).toEqual(Array.from(fromMagenta.pattern.cells));
    // 透明列必须是空格，不能被哨兵色影响成黑豆。
    for (let y = 0; y < 2; y += 1) {
      expect(fromBlack.pattern.cells[y * 4 + 2]).toBe(-1);
      expect(fromBlack.pattern.cells[y * 4 + 3]).toBe(-1);
    }
  });

  it("uses the 128 alpha threshold: 127 is empty, 128 is a bead", () => {
    // landscape 模式不开主体描边（S11 rim=false），豆色保持红色，
    // 本测试专注 alpha 阈值语义本身。
    const result = generatePattern(
      makeInput(3, 1, (x) => (x === 1 ? [255, 0, 0, 127] : [255, 0, 0, 128]), {
        mode: "landscape",
      }),
    );

    expect(result.pattern.cells[1]).toBe(-1);
    expect(result.pattern.cells[0]).toBe(RED_INDEX);
    expect(result.pattern.cells[2]).toBe(RED_INDEX);
    expect(result.stats.beadCount).toBe(2);
  });

  it("excludes transparent cells from palette-subset selection", () => {
    // maxColors = 1：若透明哨兵 (0,0,0) 参与了选色，选出的会是黑色；
    // 正确行为是只看可见的红色样本。
    const result = generatePattern(
      makeInput(2, 1, (x) => (x === 0 ? [255, 0, 0, 255] : [0, 0, 0, 0]), { maxColors: 1 }),
    );

    expect(result.pattern.palette).toHaveLength(1);
    expect(result.pattern.palette[0]?.hex).toBe("#FF0000");
    expect(result.pattern.cells[0]).toBe(0);
    expect(result.pattern.cells[1]).toBe(-1);
  });

  it("keeps a semi-transparent edge adjacent to a dark subject as subject", () => {
    const result = generatePattern(
      makeInput(2, 1, (x) => (x === 0 ? [26, 26, 26, 255] : [26, 26, 26, 128])),
    );

    expect(result.pattern.cells[0]).toBe(BLACK_INDEX);
    expect(result.pattern.cells[1]).toBe(BLACK_INDEX);
    expect(result.stats.beadCount).toBe(2);
  });
});

describe("background policy: transparency is forced to a solid color", () => {
  it("maps a fully transparent image to the background color, never black", () => {
    const result = generatePattern(
      makeInput(3, 3, () => [0, 0, 0, 0], {
        transparentPolicy: "background",
        backgroundHex: "#FFFFFF",
      }),
    );

    const cells = Array.from(result.pattern.cells);
    expect(cells).toEqual(new Array(9).fill(WHITE_INDEX));
    expect(cells).not.toContain(BLACK_INDEX);
    expect(result.stats.beadCount).toBe(9);
    expect(result.pattern.settings.backgroundHex).toBe("#FFFFFF");
  });

  it("defaults to white when backgroundHex is omitted", () => {
    const result = generatePattern(
      makeInput(2, 2, () => [0, 0, 0, 0], { transparentPolicy: "background" }),
    );

    expect(result.pattern.settings.backgroundHex).toBe("#FFFFFF");
    expect(Array.from(result.pattern.cells)).toEqual(new Array(4).fill(WHITE_INDEX));
  });

  it("normalizes lower-case background hex before persisting settings", () => {
    const result = generatePattern(
      makeInput(1, 1, () => [255, 0, 0, 0], {
        transparentPolicy: "background",
        backgroundHex: "#ffffff",
      }),
    );

    expect(result.pattern.settings.backgroundHex).toBe("#FFFFFF");
    expect(result.pattern.cells[0]).toBe(WHITE_INDEX);
  });

  it("ignores the transparent RGB sentinel entirely", () => {
    const fromBlack = generatePattern(
      makeInput(4, 1, (x) => (x % 2 === 0 ? [0, 0, 0, 0] : [26, 26, 26, 255]), {
        transparentPolicy: "background",
        backgroundHex: "#FFFFFF",
      }),
    );
    const fromMagenta = generatePattern(
      makeInput(4, 1, (x) => (x % 2 === 0 ? [255, 0, 255, 0] : [26, 26, 26, 255]), {
        transparentPolicy: "background",
        backgroundHex: "#FFFFFF",
      }),
    );

    expect(Array.from(fromBlack.pattern.cells)).toEqual(Array.from(fromMagenta.pattern.cells));
    expect(fromBlack.pattern.cells[0]).toBe(WHITE_INDEX);
    expect(fromBlack.pattern.cells[2]).toBe(WHITE_INDEX);
    expect(fromBlack.pattern.cells[1]).toBe(BLACK_INDEX);
    expect(fromBlack.pattern.cells[3]).toBe(BLACK_INDEX);
  });

  it("keeps semi-transparent edges at their visible color", () => {
    // alpha = 128 是可见的主体边缘，不是透明背景：不应被替换成背景色。
    const result = generatePattern(
      makeInput(1, 1, () => [255, 0, 0, 128], {
        transparentPolicy: "background",
        backgroundHex: "#FFFFFF",
      }),
    );

    expect(result.pattern.cells[0]).toBe(RED_INDEX);
  });
});

describe("composition -> sampling -> generation", () => {
  const WIDTH = 4;
  const HEIGHT = 2;

  function composeTransparent(): RgbaImage {
    const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    // 源图：左半深色主体，右半透明。
    for (let y = 0; y < HEIGHT; y += 1) {
      for (let x = 0; x < WIDTH / 2; x += 1) {
        const offset = (y * WIDTH + x) * 4;
        data[offset] = 26;
        data[offset + 1] = 26;
        data[offset + 2] = 26;
        data[offset + 3] = 255;
      }
    }

    const maskData = new Uint8ClampedArray(WIDTH * HEIGHT);
    for (let y = 0; y < HEIGHT; y += 1) {
      for (let x = 0; x < WIDTH / 2; x += 1) {
        maskData[y * WIDTH + x] = 255;
      }
    }

    const mask: SubjectMask = {
      sourceImageId: "source-1",
      width: WIDTH,
      height: HEIGHT,
      encoding: "raw-alpha8",
      data: maskData,
      threshold: 128,
      model: { id: "test-model", version: "1.0" },
      createdAt: "2026-10-24T00:00:00.000Z",
    };
    const bbox: BBox = { x: 0, y: 0, width: WIDTH / 2, height: HEIGHT };
    const params: CompositionParams = {
      canvasWidth: WIDTH,
      canvasHeight: HEIGHT,
      subjectScale: 1,
      offsetX: 0,
      offsetY: 0,
      backgroundType: "transparent",
      backgroundValue: null,
      margin: 0,
      subjectLocked: true,
    };

    const composed = composeImage({
      source: { width: WIDTH, height: HEIGHT, data },
      mask,
      bbox,
      params,
    });
    // 透明背景必须是 (0,0,0,0)：这是 C5 要防的“黑色哨兵”来源。
    expect(Array.from(composed.image.data.slice(0, 4))).toEqual([0, 0, 0, 0]);
    return composed.image;
  }

  const CROP = { x: 0, y: 0, width: WIDTH, height: HEIGHT };

  it("keeps the composed transparent background out of empty-mode beads", () => {
    const image = composeTransparent();
    const sampled = sampleToGrid(image as unknown as ImageData, WIDTH, HEIGHT, CROP, "empty");
    const result = generatePattern(makeInputFromSample(sampled, WIDTH, HEIGHT));

    // 主体列（1、2）是深色豆；构图留白的透明列（0、3）必须是空格。
    for (let y = 0; y < HEIGHT; y += 1) {
      expect(result.pattern.cells[y * WIDTH]).toBe(-1);
      expect(result.pattern.cells[y * WIDTH + 3]).toBe(-1);
      expect(result.pattern.cells[y * WIDTH + 1]).toBe(BLACK_INDEX);
      expect(result.pattern.cells[y * WIDTH + 2]).toBe(BLACK_INDEX);
    }
  });

  it("forces the composed transparent background to the configured color", () => {
    const image = composeTransparent();
    const sampled = sampleToGrid(
      image as unknown as ImageData,
      WIDTH,
      HEIGHT,
      CROP,
      "background",
      "#FFFFFF",
    );
    const result = generatePattern(
      makeInputFromSample(sampled, WIDTH, HEIGHT, {
        transparentPolicy: "background",
        backgroundHex: "#FFFFFF",
      }),
    );

    for (let y = 0; y < HEIGHT; y += 1) {
      expect(result.pattern.cells[y * WIDTH]).toBe(WHITE_INDEX);
      expect(result.pattern.cells[y * WIDTH + 3]).toBe(WHITE_INDEX);
      expect(result.pattern.cells[y * WIDTH + 1]).toBe(BLACK_INDEX);
      expect(result.pattern.cells[y * WIDTH + 2]).toBe(BLACK_INDEX);
    }
  });
});

describe("settings validation", () => {
  it("rejects an unknown transparent policy before touching pixels", () => {
    const input = makeInput(1, 1, () => [0, 0, 0, 255]);
    input.transparentPolicy = "screen" as GenerateInput["transparentPolicy"];

    expectPipelineCode(() => generatePattern(input), "E_INVALID_SETTINGS");
  });

  it("rejects a malformed background hex when policy is background", () => {
    expectPipelineCode(
      () =>
        generatePattern(
          makeInput(1, 1, () => [0, 0, 0, 0], {
            transparentPolicy: "background",
            backgroundHex: "white",
          }),
        ),
      "E_INVALID_SETTINGS",
    );
    expectPipelineCode(
      () =>
        generatePattern(
          makeInput(1, 1, () => [0, 0, 0, 0], {
            transparentPolicy: "background",
            backgroundHex: "#FFF",
          }),
        ),
      "E_INVALID_SETTINGS",
    );
  });
});

describe("determinism", () => {
  it("produces byte-identical cells for both policies across runs", () => {
    const painter: Painter = (x, y) =>
      y === 0 ? [26, 26, 26, 255] : x === 0 ? [255, 0, 0, 128] : [0, 0, 0, 0];

    for (const policy of ["empty", "background"] as const) {
      const options: Partial<GenerateInput> =
        policy === "background"
          ? { transparentPolicy: policy, backgroundHex: "#FFFFFF" }
          : { transparentPolicy: policy };
      const first = generatePattern(makeInput(3, 2, painter, options));
      const second = generatePattern(makeInput(3, 2, painter, options));
      expect(Array.from(first.pattern.cells)).toEqual(Array.from(second.pattern.cells));
    }
  });
});
