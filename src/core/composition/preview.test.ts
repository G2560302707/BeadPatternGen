import { describe, expect, it, vi } from "vitest";
import { DEFAULT_COMPOSITION_PARAMS, DEFAULT_MASK_THRESHOLD, SUBJECT_LABEL_MAIN } from "../subject";
import type { Composition, CompositionParams, SubjectMask, SubjectWithMask } from "../subject";
import { composeImage } from "./compose";
import { composePreview, type ComposePreviewDeps, type RgbaImage } from "./index";

const MODEL = { id: "u2netp", version: "1.0-q8", license: "Apache-2.0" };
const T0 = "2026-10-24T00:00:00.000Z";
const T1 = "2026-10-24T00:05:00.000Z";
const SUBJECT_ID = "subject-1";

function makeSource(width = 8, height = 8): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = 200;
    data[offset + 1] = 100;
    data[offset + 2] = 50;
    data[offset + 3] = 255;
  }
  return { width, height, data };
}

function makeMask(width = 8, height = 8): SubjectMask {
  const data = new Uint8ClampedArray(width * height);
  for (let y = 2; y <= 5; y += 1) {
    for (let x = 2; x <= 5; x += 1) {
      data[y * width + x] = 255;
    }
  }
  return {
    sourceImageId: "img-1",
    width,
    height,
    encoding: "raw-alpha8",
    data,
    threshold: DEFAULT_MASK_THRESHOLD,
    model: MODEL,
    createdAt: T0,
  };
}

function makeSubject(): SubjectWithMask {
  return {
    id: SUBJECT_ID,
    sourceImageId: "img-1",
    maskId: "mask-1",
    bbox: { x: 2, y: 2, width: 4, height: 4 },
    confidence: 0.9,
    label: SUBJECT_LABEL_MAIN,
    createdAt: T0,
    mask: makeMask(),
  };
}

function params(overrides: Partial<CompositionParams> = {}): CompositionParams {
  return {
    ...DEFAULT_COMPOSITION_PARAMS,
    canvasWidth: 16,
    canvasHeight: 16,
    ...overrides,
  };
}

function pixelAt(image: RgbaImage, x: number, y: number): number[] {
  const offset = (y * image.width + x) * 4;
  return [
    image.data[offset]!,
    image.data[offset + 1]!,
    image.data[offset + 2]!,
    image.data[offset + 3]!,
  ];
}

function deps(overrides: Partial<ComposePreviewDeps> = {}): ComposePreviewDeps {
  return {
    loadSubject: vi.fn(async (subjectId: string) => {
      if (subjectId !== SUBJECT_ID)
        throw Object.assign(new Error("not found"), { code: "E_NOT_FOUND" });
      return makeSubject();
    }),
    ...overrides,
  };
}

describe("composePreview", () => {
  it("loads the subject and matches the C3 engine output", async () => {
    const compositionParams = params();
    const loadSubject = vi.fn(async () => makeSubject());
    const result = await composePreview(
      { subjectId: SUBJECT_ID, params: compositionParams, source: makeSource() },
      deps({ loadSubject }),
    );

    expect(loadSubject).toHaveBeenCalledWith(SUBJECT_ID);
    expect(result.subject.id).toBe(SUBJECT_ID);
    expect(result.image.width).toBe(16);
    expect(result.image.height).toBe(16);

    const expected = composeImage({
      source: makeSource(),
      mask: makeSubject().mask,
      bbox: makeSubject().bbox,
      params: compositionParams,
    });
    expect(result.plan).toEqual(expected.plan);
    expect(result.image.data).toEqual(expected.image.data);
    // 透明背景：角落必须是全透明，不能是黑色实心。
    expect(pixelAt(result.image, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it("builds a schema-1.0 composition record with a fresh id and timestamp", async () => {
    const compositionParams = params({ backgroundType: "solid", backgroundValue: "#FFFFFF" });
    const result = await composePreview(
      { subjectId: SUBJECT_ID, params: compositionParams, source: makeSource() },
      deps({ createId: () => "comp-1", now: () => T1 }),
    );

    expect(result.composition).toEqual({
      schemaVersion: "1.0",
      id: "comp-1",
      subjectId: SUBJECT_ID,
      sourceImageId: "img-1",
      params: compositionParams,
      createdAt: T1,
      updatedAt: T1,
    });
    // 参数是副本：后续 UI 修改草稿不会污染已保存记录。
    expect(result.composition.params).not.toBe(compositionParams);
    expect(pixelAt(result.image, 0, 0)).toEqual([255, 255, 255, 255]);
  });

  it("reuses compositionId / createdAt when updating an existing composition", async () => {
    const saved: Composition[] = [];
    const result = await composePreview(
      {
        subjectId: SUBJECT_ID,
        params: params(),
        source: makeSource(),
        compositionId: "comp-existing",
        createdAt: T0,
      },
      deps({
        saveComposition: async (composition) => {
          saved.push(composition);
          return composition;
        },
        now: () => T1,
      }),
    );

    expect(result.composition.id).toBe("comp-existing");
    expect(result.composition.createdAt).toBe(T0);
    expect(result.composition.updatedAt).toBe(T1);
    expect(saved).toEqual([result.composition]);
  });

  it("skips persistence when no saveComposition dependency is provided", async () => {
    const result = await composePreview(
      { subjectId: SUBJECT_ID, params: params(), source: makeSource() },
      deps(),
    );
    expect(result.composition.id).not.toBe("");
  });

  it("forwards the background image only when provided", async () => {
    const dark: RgbaImage = {
      width: 1,
      height: 1,
      data: new Uint8ClampedArray([0, 0, 0, 255]),
    };
    const withBackground = await composePreview(
      {
        subjectId: SUBJECT_ID,
        params: params({ backgroundType: "image", backgroundValue: "bg-1" }),
        source: makeSource(),
        backgroundImage: dark,
      },
      deps(),
    );
    expect(pixelAt(withBackground.image, 0, 0)).toEqual([0, 0, 0, 255]);

    await expect(
      composePreview(
        {
          subjectId: SUBJECT_ID,
          params: params({ backgroundType: "image", backgroundValue: "bg-1" }),
          source: makeSource(),
        },
        deps(),
      ),
    ).rejects.toMatchObject({ code: "E_COMPOSITION_FAILED" });
  });

  it("maps storage and composition failures to integration codes", async () => {
    await expect(
      composePreview({ subjectId: "missing", params: params(), source: makeSource() }, deps()),
    ).rejects.toMatchObject({ code: "E_STORAGE_FAILED", recoverable: false });

    await expect(
      composePreview(
        { subjectId: SUBJECT_ID, params: params({ subjectScale: 2 }), source: makeSource() },
        deps(),
      ),
    ).rejects.toMatchObject({ code: "E_COMPOSITION_FAILED" });
  });

  it("rejects an empty subjectId before touching storage", async () => {
    const loadSubject = vi.fn(async () => makeSubject());
    await expect(
      composePreview(
        { subjectId: "", params: params(), source: makeSource() },
        deps({ loadSubject }),
      ),
    ).rejects.toMatchObject({ code: "E_INPUT_INVALID" });
    expect(loadSubject).not.toHaveBeenCalled();
  });
});
