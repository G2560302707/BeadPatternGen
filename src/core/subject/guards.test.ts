import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMPOSITION_PARAMS,
  SUBJECT_LABEL_MAIN,
  isBBox,
  isComposition,
  isCompositionParams,
  isSegmentationDoneResponse,
  isSegmentationErrorResponse,
  isSegmentationProgressResponse,
  isSegmentationStage,
  isSegmentationWorkerResponse,
  isSubject,
  isSubjectCandidate,
  isSubjectMask,
  isSubjectWithMask,
} from "./index";
import type {
  Composition,
  SegmentationModelRef,
  Subject,
  SubjectCandidate,
  SubjectMask,
} from "./index";

const MODEL: SegmentationModelRef = {
  id: "u2netp",
  version: "1.0-q8",
  license: "Apache-2.0",
};
const T0 = "2026-10-24T00:00:00.000Z";

function makeMask(overrides: Partial<SubjectMask> = {}): SubjectMask {
  return {
    sourceImageId: "img-1",
    width: 2,
    height: 2,
    encoding: "raw-alpha8",
    data: new Uint8ClampedArray([0, 255, 255, 0]),
    threshold: 128,
    model: MODEL,
    createdAt: T0,
    ...overrides,
  };
}

function makeSubject(overrides: Partial<Subject> = {}): Subject {
  return {
    id: "s1",
    sourceImageId: "img-1",
    maskId: "mask-1",
    bbox: { x: 0, y: 0, width: 2, height: 2 },
    confidence: 0.9,
    label: SUBJECT_LABEL_MAIN,
    createdAt: T0,
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<SubjectCandidate> = {}): SubjectCandidate {
  return {
    id: "cand-1",
    sourceImageId: "img-1",
    mask: makeMask(),
    bbox: { x: 0, y: 0, width: 2, height: 2 },
    confidence: 0.9,
    label: SUBJECT_LABEL_MAIN,
    createdAt: T0,
    ...overrides,
  };
}

function makeComposition(overrides: Partial<Composition> = {}): Composition {
  return {
    schemaVersion: "1.0",
    id: "comp-1",
    subjectId: "s1",
    sourceImageId: "img-1",
    params: { ...DEFAULT_COMPOSITION_PARAMS },
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

describe("mask guards", () => {
  it("accepts a self-consistent raw mask", () => {
    expect(isSubjectMask(makeMask())).toBe(true);
  });

  it("rejects masks whose data length does not match width × height", () => {
    expect(isSubjectMask(makeMask({ width: 3 }))).toBe(false);
    expect(isSubjectMask({ ...makeMask(), data: [0, 255, 255, 0] })).toBe(false);
  });

  it("rejects unsupported encodings, thresholds and timestamps", () => {
    expect(isSubjectMask({ ...makeMask(), encoding: "png-alpha8" })).toBe(false);
    expect(isSubjectMask(makeMask({ threshold: 300 }))).toBe(false);
    expect(isSubjectMask(makeMask({ threshold: -1 }))).toBe(false);
    expect(isSubjectMask(makeMask({ createdAt: "not-a-date" }))).toBe(false);
  });

  it("rejects malformed model references and image ids", () => {
    expect(isSubjectMask(makeMask({ model: { id: "", version: "1" } }))).toBe(false);
    expect(isSubjectMask(makeMask({ sourceImageId: "" }))).toBe(false);
  });
});

describe("bbox and subject guards", () => {
  it("requires non-negative integer coordinates and positive size", () => {
    expect(isBBox({ x: 0, y: 0, width: 1, height: 1 })).toBe(true);
    expect(isBBox({ x: -1, y: 0, width: 1, height: 1 })).toBe(false);
    expect(isBBox({ x: 0.5, y: 0, width: 1, height: 1 })).toBe(false);
    expect(isBBox({ x: 0, y: 0, width: 0, height: 1 })).toBe(false);
    expect(isBBox({ x: 0, y: 0, width: 1 })).toBe(false);
  });

  it("validates persisted subjects and their confidence range", () => {
    expect(isSubject(makeSubject())).toBe(true);
    expect(isSubject(makeSubject({ confidence: 1 }))).toBe(true);
    expect(isSubject(makeSubject({ confidence: 1.2 }))).toBe(false);
    expect(isSubject(makeSubject({ maskId: "" }))).toBe(false);
  });

  it("requires the attached mask to belong to the same source image", () => {
    expect(isSubjectWithMask({ ...makeSubject(), mask: makeMask() })).toBe(true);
    expect(
      isSubjectWithMask({ ...makeSubject(), mask: makeMask({ sourceImageId: "img-2" }) }),
    ).toBe(false);
  });
});

describe("candidate guards", () => {
  it("accepts a candidate with an optional thumbnail reference", () => {
    expect(isSubjectCandidate(makeCandidate())).toBe(true);
    expect(
      isSubjectCandidate(makeCandidate({ thumbnail: { id: "thumb-1", width: 1, height: 1 } })),
    ).toBe(true);
    expect(
      isSubjectCandidate(makeCandidate({ thumbnail: { id: "thumb-1", width: 0, height: 1 } })),
    ).toBe(false);
  });

  it("rejects candidates whose mask belongs to another image", () => {
    expect(isSubjectCandidate(makeCandidate({ mask: makeMask({ sourceImageId: "img-2" }) }))).toBe(
      false,
    );
  });
});

describe("composition guards", () => {
  it("accepts the shared default parameters", () => {
    expect(isCompositionParams(DEFAULT_COMPOSITION_PARAMS)).toBe(true);
    expect(
      isCompositionParams({
        ...DEFAULT_COMPOSITION_PARAMS,
        backgroundType: "solid",
        backgroundValue: "#FFFFFF",
      }),
    ).toBe(true);
    expect(
      isCompositionParams({
        ...DEFAULT_COMPOSITION_PARAMS,
        backgroundType: "image",
        backgroundValue: "bg-1",
      }),
    ).toBe(true);
  });

  it("enforces background type / value pairing", () => {
    expect(isCompositionParams({ ...DEFAULT_COMPOSITION_PARAMS, backgroundValue: "#FFFFFF" })).toBe(
      false,
    );
    expect(
      isCompositionParams({
        ...DEFAULT_COMPOSITION_PARAMS,
        backgroundType: "solid",
        backgroundValue: "white",
      }),
    ).toBe(false);
    expect(
      isCompositionParams({
        ...DEFAULT_COMPOSITION_PARAMS,
        backgroundType: "image",
        backgroundValue: "",
      }),
    ).toBe(false);
  });

  it("rejects out-of-range scale, offsets and margins", () => {
    expect(isCompositionParams({ ...DEFAULT_COMPOSITION_PARAMS, subjectScale: 0 })).toBe(false);
    expect(isCompositionParams({ ...DEFAULT_COMPOSITION_PARAMS, subjectScale: 1.1 })).toBe(false);
    expect(isCompositionParams({ ...DEFAULT_COMPOSITION_PARAMS, offsetX: 1.01 })).toBe(false);
    expect(isCompositionParams({ ...DEFAULT_COMPOSITION_PARAMS, offsetY: -1.01 })).toBe(false);
    expect(isCompositionParams({ ...DEFAULT_COMPOSITION_PARAMS, margin: 0.6 })).toBe(false);
    expect(isCompositionParams({ ...DEFAULT_COMPOSITION_PARAMS, canvasWidth: 0 })).toBe(false);
  });

  it("validates whole compositions including schema version", () => {
    expect(isComposition(makeComposition())).toBe(true);
    expect(isComposition({ ...makeComposition(), schemaVersion: "2.0" })).toBe(false);
    expect(isComposition({ ...makeComposition(), subjectId: "" })).toBe(false);
  });
});

describe("segmentation protocol guards", () => {
  it("validates stage labels", () => {
    expect(isSegmentationStage("load-model")).toBe(true);
    expect(isSegmentationStage("inference")).toBe(true);
    expect(isSegmentationStage("decode")).toBe(false);
  });

  it("accepts the three response shapes", () => {
    const progress = {
      type: "progress",
      taskId: 1,
      stage: "inference",
      done: 1,
      total: 2,
    };
    const done = {
      type: "done",
      taskId: 1,
      sourceImageId: "img-1",
      candidates: [makeCandidate()],
    };
    const error = {
      type: "error",
      taskId: 1,
      code: "E_MODEL_LOAD_FAILED",
      message: "下载失败",
      recoverable: true,
    };

    expect(isSegmentationProgressResponse(progress)).toBe(true);
    expect(isSegmentationDoneResponse(done)).toBe(true);
    expect(isSegmentationErrorResponse(error)).toBe(true);
    expect(isSegmentationWorkerResponse(progress)).toBe(true);
    expect(isSegmentationWorkerResponse(done)).toBe(true);
    expect(isSegmentationWorkerResponse(error)).toBe(true);
  });

  it("rejects malformed responses", () => {
    expect(isSegmentationWorkerResponse({ type: "progress", taskId: 1, stage: "x" })).toBe(false);
    expect(
      isSegmentationDoneResponse({
        type: "done",
        taskId: 1,
        sourceImageId: "img-1",
        candidates: [{ id: "bad" }],
      }),
    ).toBe(false);
    expect(
      isSegmentationErrorResponse({
        type: "error",
        taskId: -1,
        code: "E_INFERENCE_FAILED",
        message: "",
        recoverable: false,
      }),
    ).toBe(false);
    expect(isSegmentationWorkerResponse({ type: "unknown", taskId: 1 })).toBe(false);
  });
});
