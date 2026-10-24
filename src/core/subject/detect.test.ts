import { describe, expect, it, vi } from "vitest";
import { detectSubjects } from "./detect";
import type { DetectSubjectsDeps } from "./detect";
import type { SubjectProgressEvent } from "./protocol";
import { SegmentationError } from "./segmentation/errors";
import { DEFAULT_MASK_THRESHOLD, SUBJECT_LABEL_MAIN } from "./types";
import type {
  SegmentationInput,
  SegmentationProgressResponse,
  Subject,
  SubjectCandidate,
  SubjectMask,
} from "./types";

const MODEL = { id: "u2netp", version: "1.0-q8", license: "Apache-2.0" };
const T0 = "2026-10-24T00:00:00.000Z";
const IMAGE_BYTES = new Uint8Array([137, 80, 78, 71]);

function makeMask(
  sourceImageId: string,
  width: number,
  height: number,
  foreground: (x: number, y: number) => boolean,
): SubjectMask {
  const data = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (foreground(x, y)) data[y * width + x] = 255;
    }
  }
  return {
    sourceImageId,
    width,
    height,
    encoding: "raw-alpha8",
    data,
    threshold: DEFAULT_MASK_THRESHOLD,
    model: MODEL,
    createdAt: T0,
  };
}

/** 4×4 实心块 + 左上角一个孤立噪点。 */
function maskWithNoise(sourceImageId = "img-1"): SubjectMask {
  return makeMask(sourceImageId, 8, 8, (x, y) => {
    if (x === 0 && y === 0) return true;
    return x >= 2 && x <= 5 && y >= 2 && y <= 5;
  });
}

function makeCandidate(
  mask: SubjectMask,
  overrides: Partial<SubjectCandidate> = {},
): SubjectCandidate {
  return {
    id: "candidate-1",
    sourceImageId: mask.sourceImageId,
    mask,
    bbox: { x: 0, y: 0, width: 8, height: 8 },
    confidence: 0.9,
    label: SUBJECT_LABEL_MAIN,
    createdAt: T0,
    ...overrides,
  };
}

function runner(candidates: SubjectCandidate[]) {
  return vi.fn(async () => candidates);
}

function deps(overrides: Partial<DetectSubjectsDeps> = {}): DetectSubjectsDeps {
  return {
    segment: runner([makeCandidate(maskWithNoise())]),
    ...overrides,
  };
}

const INPUT = {
  sourceImageId: "img-1",
  imageBytes: IMAGE_BYTES,
  mimeType: "image/png",
};

describe("detectSubjects", () => {
  it("post-processes each candidate and returns the cleaned mask + bbox", async () => {
    const original = makeCandidate(maskWithNoise());
    const result = await detectSubjects(
      INPUT,
      deps({ segment: runner([original]), postProcess: { denoiseMinArea: 2 } }),
    );

    expect(result.sourceImageId).toBe("img-1");
    expect(result.candidates).toHaveLength(1);
    expect(result.droppedCandidates).toBe(0);
    expect(result.postProcessed).toEqual([
      { candidateId: "candidate-1", removedComponents: 1, filledPixels: 0 },
    ]);

    const cleaned = result.candidates[0]!;
    // 噪点被清除，bbox 只覆盖 4×4 主体块。
    expect(cleaned.mask.data[0]).toBe(0);
    expect(cleaned.bbox).toEqual({ x: 2, y: 2, width: 4, height: 4 });
    // 原候选不被修改（C2 契约：返回新数组）。
    expect(original.mask.data[0]).toBe(255);
    expect(cleaned.mask.data).not.toBe(original.mask.data);
  });

  it("forwards the segmentation request and progress unchanged", async () => {
    const segment = vi.fn(
      async (
        input: SegmentationInput,
        callbacks?: { onProgress?: (progress: SegmentationProgressResponse) => void },
      ) => {
        callbacks?.onProgress?.({
          type: "progress",
          taskId: 7,
          stage: "inference",
          done: 1,
          total: 2,
        });
        return [makeCandidate(maskWithNoise(input.sourceImageId))];
      },
    );
    const events: SubjectProgressEvent[] = [];

    await detectSubjects(
      { ...INPUT, modelId: "u2netp", maxCandidates: 1 },
      deps({ segment, taskId: 7, onProgress: (event) => events.push(event) }),
    );

    expect(segment).toHaveBeenCalledTimes(1);
    expect(segment.mock.calls[0]![0]).toMatchObject({
      sourceImageId: "img-1",
      mimeType: "image/png",
      modelId: "u2netp",
      maxCandidates: 1,
    });

    expect(events.map((event) => event.stage)).toEqual([
      "inference",
      "mask-cleanup",
      "mask-cleanup",
    ]);
    expect(events.every((event) => event.taskId === 7)).toBe(true);
  });

  it("persists subjects with a fresh maskId and the candidate id", async () => {
    const saved: Array<{ subject: Subject; mask: SubjectMask }> = [];
    const saveSubject = vi.fn(async (subject: Subject, mask: SubjectMask) => {
      saved.push({ subject, mask });
      return subject;
    });
    const events: SubjectProgressEvent[] = [];

    const result = await detectSubjects(
      INPUT,
      deps({
        saveSubject,
        postProcess: { denoiseMinArea: 2 },
        createId: () => "mask-1",
        now: () => T0,
        taskId: 3,
        onProgress: (event) => events.push(event),
      }),
    );

    expect(saveSubject).toHaveBeenCalledTimes(1);
    expect(saved[0]!.subject).toEqual({
      id: "candidate-1",
      sourceImageId: "img-1",
      maskId: "mask-1",
      bbox: { x: 2, y: 2, width: 4, height: 4 },
      confidence: 0.9,
      label: SUBJECT_LABEL_MAIN,
      createdAt: T0,
    });
    expect(saved[0]!.mask.data[0]).toBe(0);
    expect(result.subjects).toEqual([saved[0]!.subject]);

    // persist 阶段按已保存数量上报。
    expect(events.filter((event) => event.stage === "persist")).toEqual([
      { taskId: 3, stage: "persist", done: 0, total: 1 },
      { taskId: 3, stage: "persist", done: 1, total: 1 },
    ]);
  });

  it("skips persistence when persist=false", async () => {
    const saveSubject = vi.fn(async (subject: Subject) => subject);

    const result = await detectSubjects({ ...INPUT, persist: false }, deps({ saveSubject }));

    expect(saveSubject).not.toHaveBeenCalled();
    expect(result.subjects).toEqual([]);
    expect(result.candidates).toHaveLength(1);
  });

  it("rejects with E_NO_SUBJECT when the runner finds nothing", async () => {
    await expect(detectSubjects(INPUT, deps({ segment: runner([]) }))).rejects.toMatchObject({
      code: "E_NO_SUBJECT",
      recoverable: true,
    });
  });

  it("drops candidates that vanish after post-processing, then fails if none remain", async () => {
    const empty = makeMask("img-1", 8, 8, () => false);

    await expect(
      detectSubjects(
        INPUT,
        deps({ segment: runner([makeCandidate(empty)]), postProcess: { denoiseMinArea: 2 } }),
      ),
    ).rejects.toMatchObject({ code: "E_NO_SUBJECT" });
  });

  it("keeps the surviving candidates and reports how many were dropped", async () => {
    const empty = makeMask("img-1", 8, 8, () => false);
    const result = await detectSubjects(
      INPUT,
      deps({
        segment: runner([
          makeCandidate(empty, { id: "empty" }),
          makeCandidate(maskWithNoise(), { id: "good" }),
        ]),
        postProcess: { denoiseMinArea: 2 },
      }),
    );

    expect(result.droppedCandidates).toBe(1);
    expect(result.candidates.map((item) => item.id)).toEqual(["good"]);
  });

  it("maps segmentation and storage failures to stable integration codes", async () => {
    const modelFailure = deps({
      segment: vi.fn(async () => {
        throw new SegmentationError("E_MODEL_LOAD_FAILED", "模型下载失败", true);
      }),
    });
    await expect(detectSubjects(INPUT, modelFailure)).rejects.toMatchObject({
      code: "E_MODEL_LOAD_FAILED",
      recoverable: true,
    });

    const storageFailure = deps({
      saveSubject: vi.fn(async () => {
        throw Object.assign(new Error("IDB 不可用"), { code: "E_IDB_UNAVAILABLE" });
      }),
    });
    await expect(detectSubjects(INPUT, storageFailure)).rejects.toMatchObject({
      code: "E_STORAGE_FAILED",
      recoverable: false,
    });
  });

  it("rejects candidates whose sourceImageId does not match", async () => {
    const mismatched = makeCandidate(maskWithNoise("other-image"));

    await expect(
      detectSubjects(INPUT, deps({ segment: runner([mismatched]) })),
    ).rejects.toMatchObject({ code: "E_SUBJECT_INVALID", recoverable: false });
  });

  it("validates input before touching the runner", async () => {
    const segment = runner([]);

    await expect(
      detectSubjects({ ...INPUT, imageBytes: new Uint8Array() }, deps({ segment })),
    ).rejects.toMatchObject({ code: "E_INPUT_INVALID" });
    expect(segment).not.toHaveBeenCalled();
  });
});

describe("detectSubjects · replaceExisting", () => {
  const previousSubject: Subject = {
    id: "old-1",
    sourceImageId: "img-1",
    maskId: "old-mask-1",
    bbox: { x: 0, y: 0, width: 4, height: 4 },
    confidence: 0.5,
    label: SUBJECT_LABEL_MAIN,
    createdAt: T0,
  };

  function repoStubs(subjects: Subject[]) {
    return {
      saveSubject: vi.fn(async (subject: Subject) => subject),
      listSubjects: vi.fn(async () => subjects),
      removeSubject: vi.fn(async () => undefined),
    };
  }

  it("deletes the previous subjects of the same image before saving", async () => {
    const repo = repoStubs([previousSubject]);

    const result = await detectSubjects(
      { ...INPUT, replaceExisting: true },
      deps({ ...repo, postProcess: { denoiseMinArea: 2 }, createId: () => "mask-1" }),
    );

    expect(repo.listSubjects).toHaveBeenCalledWith("img-1");
    expect(repo.removeSubject).toHaveBeenCalledWith("old-1");
    expect(result.replaced).toEqual([previousSubject]);
    expect(result.subjects).toHaveLength(1);
    // 新记录先于旧记录的删除完成，所以 remove 必须发生在 save 之前。
    expect(repo.removeSubject.mock.invocationCallOrder[0]!).toBeLessThan(
      repo.saveSubject.mock.invocationCallOrder[0]!,
    );
  });

  it("keeps existing records when the option is omitted", async () => {
    const repo = repoStubs([previousSubject]);

    const result = await detectSubjects(
      INPUT,
      deps({ ...repo, postProcess: { denoiseMinArea: 2 }, createId: () => "mask-1" }),
    );

    expect(repo.removeSubject).not.toHaveBeenCalled();
    expect(result.replaced).toEqual([]);
  });

  it("requires both list and remove dependencies", async () => {
    await expect(
      detectSubjects(
        { ...INPUT, replaceExisting: true },
        deps({ saveSubject: vi.fn(async (subject: Subject) => subject) }),
      ),
    ).rejects.toMatchObject({ code: "E_INPUT_INVALID", recoverable: false });
  });

  it("maps a storage failure during cleanup to E_STORAGE_FAILED", async () => {
    await expect(
      detectSubjects(
        { ...INPUT, replaceExisting: true },
        deps({
          saveSubject: vi.fn(async (subject: Subject) => subject),
          listSubjects: vi.fn(async () => [previousSubject]),
          removeSubject: vi.fn(async () => {
            throw Object.assign(new Error("删除失败"), { code: "E_ID_CONFLICT" });
          }),
        }),
      ),
    ).rejects.toMatchObject({ code: "E_STORAGE_FAILED" });
  });
});
