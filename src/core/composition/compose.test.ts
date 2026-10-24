import { describe, expect, it } from "vitest";
import { DEFAULT_COMPOSITION_PARAMS } from "../subject";
import type { BBox, CompositionParams, SubjectMask } from "../subject";
import { CompositionError, composeImage } from "./index";
import type { CompositionErrorCode, RgbaImage } from "./index";

const MODEL = { id: "u2netp", version: "1.0-q8", license: "Apache-2.0" };
const T0 = "2026-10-24T00:00:00.000Z";

type Pixel = readonly [number, number, number, number];

function makeImage(
  width: number,
  height: number,
  pixel: Pixel | ((x: number, y: number) => Pixel),
): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = typeof pixel === "function" ? pixel(x, y) : pixel;
      const offset = (y * width + x) * 4;
      data[offset] = r;
      data[offset + 1] = g;
      data[offset + 2] = b;
      data[offset + 3] = a;
    }
  }
  return { width, height, data };
}

function makeMask(
  width: number,
  height: number,
  pixel: (x: number, y: number) => number,
  threshold = 128,
): SubjectMask {
  const data = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data[y * width + x] = pixel(x, y);
    }
  }
  return {
    sourceImageId: "img-1",
    width,
    height,
    encoding: "raw-alpha8",
    data,
    threshold,
    model: MODEL,
    createdAt: T0,
  };
}

function params(overrides: Partial<CompositionParams> = {}): CompositionParams {
  return { ...DEFAULT_COMPOSITION_PARAMS, ...overrides };
}

function pixelAt(image: RgbaImage, x: number, y: number): number[] {
  const offset = (y * image.width + x) * 4;
  return [
    image.data[offset] ?? -1,
    image.data[offset + 1] ?? -1,
    image.data[offset + 2] ?? -1,
    image.data[offset + 3] ?? -1,
  ];
}

function captureError(action: () => unknown): CompositionError {
  try {
    action();
  } catch (error) {
    if (error instanceof CompositionError) return error;
    throw error;
  }
  throw new Error("expected CompositionError, but no error was thrown");
}

function expectCode(code: CompositionErrorCode, action: () => unknown): void {
  expect(captureError(action).code).toBe(code);
}

const FULL_2x2: BBox = { x: 0, y: 0, width: 2, height: 2 };

describe("composeImage · 透明背景", () => {
  it("保留 Alpha，背景像素为 (0,0,0,0) 而不是不透明黑色", () => {
    const source = makeImage(2, 2, [255, 0, 0, 255]);
    const mask = makeMask(2, 2, (x) => (x === 0 ? 255 : 0));
    const result = composeImage({
      source,
      mask,
      bbox: FULL_2x2,
      params: params({
        canvasWidth: 4,
        canvasHeight: 4,
        subjectScale: 1,
        margin: 0,
        backgroundType: "transparent",
      }),
    });

    expect(result.image.width).toBe(4);
    expect(result.image.height).toBe(4);
    expect(pixelAt(result.image, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(result.image, 1, 3)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(result.image, 2, 0)).toEqual([0, 0, 0, 0]);
    expect(pixelAt(result.image, 3, 3)).toEqual([0, 0, 0, 0]);
    expect(result.plan.subjectRect).toEqual({ x: 0, y: 0, width: 4, height: 4 });
  });

  it("主体缩小时画布其余区域保持全透明", () => {
    const source = makeImage(2, 2, [255, 0, 0, 255]);
    const mask = makeMask(2, 2, () => 255);
    const result = composeImage({
      source,
      mask,
      bbox: FULL_2x2,
      params: params({ canvasWidth: 4, canvasHeight: 4, subjectScale: 0.5, margin: 0 }),
    });

    expect(pixelAt(result.image, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(pixelAt(result.image, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(result.image, 2, 2)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(result.image, 3, 3)).toEqual([0, 0, 0, 0]);
  });

  it("bbox 之外的源图内容不会被画进画布", () => {
    const source = makeImage(4, 4, (x, y) => [x * 10, y * 10, 0, 255]);
    const mask = makeMask(4, 4, () => 255);
    const result = composeImage({
      source,
      mask,
      bbox: { x: 1, y: 1, width: 2, height: 2 },
      params: params({ canvasWidth: 4, canvasHeight: 4, subjectScale: 0.5, margin: 0 }),
    });

    expect(pixelAt(result.image, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(pixelAt(result.image, 3, 3)).toEqual([0, 0, 0, 0]);
    expect(pixelAt(result.image, 1, 1)).toEqual([10, 10, 0, 255]);
    expect(pixelAt(result.image, 2, 2)).toEqual([20, 20, 0, 255]);
  });

  it("主体 alpha = 蒙版置信度 × 源图 alpha / 255", () => {
    const source = makeImage(1, 1, [10, 20, 30, 128]);
    const mask = makeMask(1, 1, () => 255);
    const result = composeImage({
      source,
      mask,
      bbox: { x: 0, y: 0, width: 1, height: 1 },
      params: params({ canvasWidth: 1, canvasHeight: 1, subjectScale: 1, margin: 0 }),
    });
    expect(pixelAt(result.image, 0, 0)).toEqual([10, 20, 30, 128]);
  });

  it("羽化产生的低置信度像素以半透明形式保留", () => {
    const source = makeImage(1, 1, [10, 20, 30, 255]);
    const mask = makeMask(1, 1, () => 64);
    const result = composeImage({
      source,
      mask,
      bbox: { x: 0, y: 0, width: 1, height: 1 },
      params: params({ canvasWidth: 1, canvasHeight: 1, subjectScale: 1, margin: 0 }),
    });
    expect(pixelAt(result.image, 0, 0)).toEqual([10, 20, 30, 64]);
  });
});

describe("composeImage · 纯色背景", () => {
  it("背景填充为不透明纯色，主体做 source-over 合成", () => {
    const source = makeImage(2, 2, [255, 0, 0, 255]);
    const mask = makeMask(2, 2, (x) => (x === 0 ? 255 : 0));
    const result = composeImage({
      source,
      mask,
      bbox: FULL_2x2,
      params: params({
        canvasWidth: 4,
        canvasHeight: 4,
        subjectScale: 1,
        margin: 0,
        backgroundType: "solid",
        backgroundValue: "#00FF00",
      }),
    });

    expect(pixelAt(result.image, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(result.image, 2, 0)).toEqual([0, 255, 0, 255]);
    expect(pixelAt(result.image, 3, 3)).toEqual([0, 255, 0, 255]);
  });

  it("半透明主体与纯色背景混合后不透明", () => {
    const source = makeImage(1, 1, [255, 255, 255, 255]);
    const mask = makeMask(1, 1, () => 128);
    const result = composeImage({
      source,
      mask,
      bbox: { x: 0, y: 0, width: 1, height: 1 },
      params: params({
        canvasWidth: 1,
        canvasHeight: 1,
        subjectScale: 1,
        margin: 0,
        backgroundType: "solid",
        backgroundValue: "#000000",
      }),
    });
    // 255 × 128/255 + 0 × (1 - 128/255) = 128。
    expect(pixelAt(result.image, 0, 0)).toEqual([128, 128, 128, 255]);
  });
});

describe("composeImage · 自定义背景图", () => {
  it("按 cover 铺满画布", () => {
    const source = makeImage(1, 1, [255, 0, 0, 255]);
    const mask = makeMask(1, 1, () => 0);
    const background = makeImage(1, 1, [0, 0, 255, 255]);
    const result = composeImage({
      source,
      mask,
      bbox: { x: 0, y: 0, width: 1, height: 1 },
      backgroundImage: background,
      params: params({
        canvasWidth: 2,
        canvasHeight: 2,
        subjectScale: 1,
        margin: 0,
        backgroundType: "image",
        backgroundValue: "bg-1",
      }),
    });
    expect(pixelAt(result.image, 0, 0)).toEqual([0, 0, 255, 255]);
    expect(pixelAt(result.image, 1, 1)).toEqual([0, 0, 255, 255]);
  });

  it("背景图带 alpha 时先合成到白色上", () => {
    const source = makeImage(1, 1, [255, 0, 0, 255]);
    const mask = makeMask(1, 1, () => 0);
    const background = makeImage(1, 1, [0, 0, 0, 0]);
    const result = composeImage({
      source,
      mask,
      bbox: { x: 0, y: 0, width: 1, height: 1 },
      backgroundImage: background,
      params: params({
        canvasWidth: 2,
        canvasHeight: 2,
        subjectScale: 1,
        margin: 0,
        backgroundType: "image",
        backgroundValue: "bg-1",
      }),
    });
    expect(pixelAt(result.image, 0, 0)).toEqual([255, 255, 255, 255]);
  });

  it("image 背景缺少背景图时报 E_BACKGROUND_REQUIRED", () => {
    expectCode("E_BACKGROUND_REQUIRED", () =>
      composeImage({
        source: makeImage(1, 1, [255, 0, 0, 255]),
        mask: makeMask(1, 1, () => 255),
        bbox: { x: 0, y: 0, width: 1, height: 1 },
        params: params({
          canvasWidth: 1,
          canvasHeight: 1,
          subjectScale: 1,
          margin: 0,
          backgroundType: "image",
          backgroundValue: "bg-1",
        }),
      }),
    );
  });

  it("背景图尺寸非法时报 E_SOURCE_INVALID", () => {
    expectCode("E_SOURCE_INVALID", () =>
      composeImage({
        source: makeImage(1, 1, [255, 0, 0, 255]),
        mask: makeMask(1, 1, () => 255),
        bbox: { x: 0, y: 0, width: 1, height: 1 },
        backgroundImage: { width: 2, height: 2, data: new Uint8ClampedArray(3) },
        params: params({
          canvasWidth: 1,
          canvasHeight: 1,
          subjectScale: 1,
          margin: 0,
          backgroundType: "image",
          backgroundValue: "bg-1",
        }),
      }),
    );
  });
});

describe("composeImage · 校验与确定性", () => {
  it("蒙版尺寸与源图不一致时报 E_MASK_SIZE_MISMATCH", () => {
    expectCode("E_MASK_SIZE_MISMATCH", () =>
      composeImage({
        source: makeImage(2, 2, [0, 0, 0, 255]),
        mask: makeMask(3, 3, () => 255),
        bbox: { x: 0, y: 0, width: 2, height: 2 },
        params: params({ canvasWidth: 2, canvasHeight: 2, subjectScale: 1, margin: 0 }),
      }),
    );
  });

  it("源图数据长度不对时报 E_SOURCE_INVALID", () => {
    expectCode("E_SOURCE_INVALID", () =>
      composeImage({
        source: { width: 2, height: 2, data: new Uint8ClampedArray(4) },
        mask: makeMask(2, 2, () => 255),
        bbox: FULL_2x2,
        params: params({ canvasWidth: 2, canvasHeight: 2, subjectScale: 1, margin: 0 }),
      }),
    );
  });

  it("bbox 越界时报 E_BBOX_INVALID", () => {
    expectCode("E_BBOX_INVALID", () =>
      composeImage({
        source: makeImage(2, 2, [0, 0, 0, 255]),
        mask: makeMask(2, 2, () => 255),
        bbox: { x: 1, y: 1, width: 2, height: 2 },
        params: params({ canvasWidth: 2, canvasHeight: 2, subjectScale: 1, margin: 0 }),
      }),
    );
  });

  it("offset 超界时输出仍不越界，并带回修正建议", () => {
    const result = composeImage({
      source: makeImage(2, 2, [255, 0, 0, 255]),
      mask: makeMask(2, 2, () => 255),
      bbox: FULL_2x2,
      params: params({
        canvasWidth: 4,
        canvasHeight: 4,
        subjectScale: 0.5,
        margin: 0.1,
        offsetX: 1,
      }),
    });
    expect(result.plan.adjusted).toBe(true);
    expect(result.plan.suggestion.offsetX).toBeLessThan(1);
    expect(result.plan.subjectRect.x + result.plan.subjectRect.width).toBeLessThanOrEqual(
      result.plan.contentRect.x + result.plan.contentRect.width,
    );
  });

  it("同输入重复调用输出逐字节一致", () => {
    const input = {
      source: makeImage(6, 4, (x, y) => [x * 20, y * 30, (x + y) * 10, 255] as const),
      mask: makeMask(6, 4, (x, y) => (x > 0 && x < 5 && y > 0 && y < 3 ? 255 : 0)),
      bbox: { x: 1, y: 1, width: 4, height: 2 } as BBox,
      params: params({
        canvasWidth: 8,
        canvasHeight: 8,
        subjectScale: 0.7,
        offsetX: 0.1,
        offsetY: -0.1,
        backgroundType: "solid",
        backgroundValue: "#123456",
      }),
    };
    const first = composeImage(input);
    const second = composeImage(input);
    expect(Array.from(first.image.data)).toEqual(Array.from(second.image.data));
    expect(first.plan).toEqual(second.plan);
  });
});
