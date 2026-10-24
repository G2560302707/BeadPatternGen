import { afterEach, describe, expect, it, vi } from "vitest";
import { SegmentationError } from "../../core/subject";
import { createMockSegmentationRunner, setMockDetectScenario } from "./mock-detect";

const INPUT = {
  sourceImageId: "img",
  imageBytes: new Uint8Array([1, 2, 3]),
  mimeType: "image/png",
};

describe("createMockSegmentationRunner", () => {
  afterEach(() => {
    setMockDetectScenario("ok");
    vi.useRealTimers();
  });

  it("emits progress then a main-subject candidate", async () => {
    vi.useFakeTimers();
    const stages: string[] = [];
    const pending = createMockSegmentationRunner(40, 40)(INPUT, {
      onProgress: (progress) => stages.push(progress.stage),
    });
    await vi.runAllTimersAsync();
    const candidates = await pending;
    expect(stages).toEqual(["load-model", "preprocess", "inference", "postprocess"]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.id).toBe("mock-main");
    expect(candidates[0]?.mask.width).toBe(40);
  });

  it("covers empty / fail / multi scenarios", async () => {
    vi.useFakeTimers();
    setMockDetectScenario("empty");
    const emptyRun = createMockSegmentationRunner(20, 20)(INPUT);
    await vi.runAllTimersAsync();
    expect(await emptyRun).toEqual([]);

    setMockDetectScenario("fail");
    const failRun = createMockSegmentationRunner(20, 20)(INPUT);
    const failAssert = expect(failRun).rejects.toBeInstanceOf(SegmentationError);
    await vi.runAllTimersAsync();
    await failAssert;

    setMockDetectScenario("multi");
    const multiRun = createMockSegmentationRunner(30, 30)(INPUT);
    await vi.runAllTimersAsync();
    expect(await multiRun).toHaveLength(2);
  });
});
