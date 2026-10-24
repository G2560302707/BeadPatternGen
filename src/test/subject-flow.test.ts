/**
 * C6 · 主体识别 → 智能构图 → 采样 → 生成 全链路集成测试。
 *
 * 用固定蒙版模拟分割模型输出（不加载 onnx），其余环节全部走生产代码：
 * `detectSubjects`（C2 后处理 + C1 落库）→ `composePreview`（C3 + C1 构图记录）
 * → `sampleToGrid` → `generatePattern`。
 *
 * 红线：构图产生的透明背景绝不能变成黑色拼豆。
 */

import { indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import { composePreview } from "../core/composition";
import { generatePattern } from "../core/pipeline";
import type { GenerateInput } from "../core/pipeline";
import { sampleToGrid } from "../core/sampling";
import { detectSubjects } from "../core/subject";
import type { CompositionParams, SubjectCandidate, SubjectMask } from "../core/subject";
import type { BeadColor } from "../core/pattern";
import { DB_NAME } from "../storage/db";
import { createSubjectRepository } from "../storage/subject-repository";

const T0 = "2026-10-24T00:00:00.000Z";
const WIDTH = 16;
const HEIGHT = 16;
const IMAGE_BYTES = new Uint8Array([137, 80, 78, 71]);

const PALETTE: BeadColor[] = [
  { code: "W", name: "White", hex: "#FFFFFF", manufacturer: "Test" },
  { code: "K", name: "Black", hex: "#000000", manufacturer: "Test" },
  { code: "R", name: "Red", hex: "#FF0000", manufacturer: "Test" },
];

const WHITE_INDEX = 0;
const BLACK_INDEX = 1;
const RED_INDEX = 2;

/** 白底 + 中央 4×4 红色主体；左上角另有一个孤立噪点（应由 C2 清除）。 */
function makeSourceImage(): Uint8ClampedArray<ArrayBuffer> {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const offset = (y * WIDTH + x) * 4;
      const inSubject = x >= 6 && x <= 9 && y >= 6 && y <= 9;
      data[offset] = inSubject ? 255 : 245;
      data[offset + 1] = inSubject ? 0 : 245;
      data[offset + 2] = inSubject ? 0 : 245;
      data[offset + 3] = 255;
    }
  }
  return data;
}

function makeCandidateMask(): SubjectMask {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT);
  data[0] = 255; // 孤立噪点
  for (let y = 6; y <= 9; y += 1) {
    for (let x = 6; x <= 9; x += 1) {
      data[y * WIDTH + x] = 255;
    }
  }
  return {
    sourceImageId: "img-1",
    width: WIDTH,
    height: HEIGHT,
    encoding: "raw-alpha8",
    data,
    threshold: 128,
    model: { id: "mock-u2netp", version: "test" },
    createdAt: T0,
  };
}

function makeCandidate(): SubjectCandidate {
  return {
    id: "candidate-1",
    sourceImageId: "img-1",
    mask: makeCandidateMask(),
    bbox: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
    confidence: 0.93,
    label: "main-subject",
    createdAt: T0,
  };
}

const PARAMS: CompositionParams = {
  canvasWidth: WIDTH,
  canvasHeight: HEIGHT,
  subjectScale: 0.5,
  offsetX: 0,
  offsetY: 0,
  backgroundType: "transparent",
  backgroundValue: null,
  margin: 0,
  subjectLocked: true,
};

const CROP = { x: 0, y: 0, width: WIDTH, height: HEIGHT };

function makeGenerateInput(
  sampled: { rgb: Uint8ClampedArray; alpha: Uint8Array },
  overrides: Partial<GenerateInput> = {},
): GenerateInput {
  return {
    rgb: sampled.rgb,
    alpha: sampled.alpha,
    width: WIDTH,
    height: HEIGHT,
    palette: PALETTE,
    paletteId: "test-palette",
    paletteVersion: "1.0",
    maxColors: PALETTE.length,
    mode: "photo",
    dithering: "none",
    colorMetric: "ciede2000",
    transparentPolicy: "empty",
    ditherStrength: 1,
    source: { originalWidth: WIDTH, originalHeight: HEIGHT, aspectRatio: 1 },
    title: "subject-flow",
    id: "subject-flow",
    now: T0,
    ...overrides,
  };
}

function deleteDatabase(): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

async function runPipeline(): Promise<{
  cells: Int16Array;
  hexByIndex: (index: number) => string | undefined;
}> {
  const repo = createSubjectRepository(indexedDB);

  const detected = await detectSubjects(
    { sourceImageId: "img-1", imageBytes: IMAGE_BYTES, mimeType: "image/png" },
    {
      segment: async () => [makeCandidate()],
      saveSubject: (subject, mask) => repo.saveSubject(subject, mask),
      postProcess: { denoiseMinArea: 2 },
      createId: () => "mask-1",
      now: () => T0,
    },
  );
  expect(detected.subjects).toHaveLength(1);
  const subjectId = detected.subjects[0]!.id;

  // 落库的蒙版必须已经去掉噪点。
  const stored = await repo.loadSubject(subjectId);
  expect(stored.mask.data[0]).toBe(0);

  const preview = await composePreview(
    {
      subjectId,
      params: PARAMS,
      source: { width: WIDTH, height: HEIGHT, data: makeSourceImage() },
    },
    {
      loadSubject: (id) => repo.loadSubject(id),
      saveComposition: (composition) => repo.saveComposition(composition),
      createId: () => "composition-1",
      now: () => T0,
    },
  );

  expect(await repo.listCompositions(subjectId)).toHaveLength(1);

  const sampled = sampleToGrid(preview.image as unknown as ImageData, WIDTH, HEIGHT, CROP, "empty");
  const pattern = generatePattern(makeGenerateInput(sampled));

  return {
    cells: pattern.pattern.cells,
    hexByIndex: (index) => pattern.pattern.palette[index]?.hex,
  };
}

afterEach(async () => {
  await deleteDatabase();
});

describe("detect -> compose -> sample -> generate", () => {
  it("carries the detected subject through to a valid pattern", async () => {
    const { cells, hexByIndex } = await runPipeline();

    // 主体落在中央：构图缩放后仍应保留可见的红色格子。
    expect(Array.from(cells)).toContain(RED_INDEX);
    expect(hexByIndex(RED_INDEX)).toBe("#FF0000");

    // 四角是构图留白（透明背景），empty 策略下必须是空格，而不是黑豆。
    for (const index of [0, WIDTH - 1, WIDTH * (HEIGHT - 1), WIDTH * HEIGHT - 1]) {
      expect(cells[index]).toBe(-1);
    }
    expect(Array.from(cells)).not.toContain(BLACK_INDEX);
  });

  it("keeps transparency out of the background policy too", async () => {
    const repo = createSubjectRepository(indexedDB);
    const detected = await detectSubjects(
      { sourceImageId: "img-1", imageBytes: IMAGE_BYTES, mimeType: "image/png" },
      {
        segment: async () => [makeCandidate()],
        saveSubject: (subject, mask) => repo.saveSubject(subject, mask),
        postProcess: { denoiseMinArea: 2 },
        createId: () => "mask-1",
      },
    );
    const preview = await composePreview(
      {
        subjectId: detected.subjects[0]!.id,
        params: { ...PARAMS, backgroundType: "solid", backgroundValue: "#FFFFFF" },
        source: { width: WIDTH, height: HEIGHT, data: makeSourceImage() },
      },
      { loadSubject: (id) => repo.loadSubject(id) },
    );

    const sampled = sampleToGrid(
      preview.image as unknown as ImageData,
      WIDTH,
      HEIGHT,
      CROP,
      "background",
      "#FFFFFF",
    );
    const pattern = generatePattern(
      makeGenerateInput(sampled, {
        transparentPolicy: "background",
        backgroundHex: "#FFFFFF",
      }),
    );

    expect(Array.from(pattern.pattern.cells)).not.toContain(BLACK_INDEX);
    expect(pattern.pattern.cells[0]).toBe(WHITE_INDEX);
    expect(Array.from(pattern.pattern.cells)).toContain(RED_INDEX);
  });
});
