import {
  DEFAULT_MASK_THRESHOLD,
  SUBJECT_LABEL_MAIN,
  SegmentationError,
  type SegmentationRunner,
  type SegmentationStage,
  type SubjectCandidate,
  type SubjectMask,
} from "../../core/subject";

export type MockDetectScenario = "ok" | "empty" | "fail" | "multi";

let scenario: MockDetectScenario = "ok";

export function setMockDetectScenario(next: MockDetectScenario): void {
  scenario = next;
}

export function getMockDetectScenario(): MockDetectScenario {
  return scenario;
}

export function isMockDetectScenario(value: string | null): value is MockDetectScenario {
  return value === "ok" || value === "empty" || value === "fail" || value === "multi";
}

/** E2E / 调试：从 `?mock-scenario=` 读取一次，之后可由钩子改写。 */
export function applyMockScenarioFromSearch(search: string): void {
  try {
    const raw = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get(
      "mock-scenario",
    );
    if (isMockDetectScenario(raw)) scenario = raw;
  } catch {
    /* ignore */
  }
}

if (typeof window !== "undefined") {
  applyMockScenarioFromSearch(window.location.search);
}

function ellipseMask(
  width: number,
  height: number,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  sourceImageId: string,
): SubjectMask {
  const data = new Uint8ClampedArray(width * height);
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if ((dx * dx) / rx2 + (dy * dy) / ry2 <= 1) {
        data[y * width + x] = 220;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  return {
    sourceImageId,
    width,
    height,
    encoding: "raw-alpha8",
    data,
    threshold: DEFAULT_MASK_THRESHOLD,
    model: { id: "mock-ellipse", version: "k2", license: "internal-mock" },
    createdAt: new Date().toISOString(),
  };
}

function bboxFromMask(mask: SubjectMask): { x: number; y: number; width: number; height: number } {
  let minX = mask.width;
  let minY = mask.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < mask.height; y += 1) {
    for (let x = 0; x < mask.width; x += 1) {
      if ((mask.data[y * mask.width + x] ?? 0) <= mask.threshold) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { x: 0, y: 0, width: 1, height: 1 };
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function candidate(
  id: string,
  sourceImageId: string,
  mask: SubjectMask,
  confidence: number,
): SubjectCandidate {
  return {
    id,
    sourceImageId,
    mask,
    bbox: bboxFromMask(mask),
    confidence,
    label: SUBJECT_LABEL_MAIN,
    createdAt: mask.createdAt,
  };
}

/** mock 只替换 C4 分割来源，后续后处理 / 落库走真实 `detectSubjects`。 */
export function createMockSegmentationRunner(width: number, height: number): SegmentationRunner {
  return async (input, callbacks) => {
    const stages: SegmentationStage[] = ["load-model", "preprocess", "inference", "postprocess"];
    for (const [index, stage] of stages.entries()) {
      callbacks?.onProgress?.({
        type: "progress",
        taskId: 0,
        stage,
        done: index,
        total: stages.length,
      });
      await new Promise((resolve) => setTimeout(resolve, 80));
    }

    if (scenario === "fail") {
      throw new SegmentationError(
        "E_INFERENCE_FAILED",
        "模拟识别失败。可重试，或跳过构图按整图生成。",
        true,
      );
    }
    if (scenario === "empty") {
      return [];
    }

    const sourceImageId = input.sourceImageId;
    const cx = width / 2;
    const cy = height / 2;
    const rx = Math.max(4, width * 0.28);
    const ry = Math.max(4, height * 0.34);
    const main = candidate(
      "mock-main",
      sourceImageId,
      ellipseMask(width, height, cx, cy, rx, ry, sourceImageId),
      0.91,
    );
    const extras =
      scenario === "multi"
        ? [
            candidate(
              "mock-alt",
              sourceImageId,
              ellipseMask(
                width,
                height,
                width * 0.32,
                height * 0.48,
                rx * 0.7,
                ry * 0.7,
                sourceImageId,
              ),
              0.62,
            ),
          ]
        : [];
    return [main, ...extras];
  };
}
