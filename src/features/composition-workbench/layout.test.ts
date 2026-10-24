import { describe, expect, it } from "vitest";
import { DEFAULT_COMPOSITION_PARAMS } from "../../core/subject";
import {
  canvasSizeForAspect,
  inferAspectPreset,
  inferPositionPreset,
  layoutSubject,
  offsetsForPosition,
} from "./layout";

describe("composition layout", () => {
  it("maps aspect presets to 1:1 / 3:4 / 4:3", () => {
    expect(canvasSizeForAspect("square", 400)).toEqual({ width: 400, height: 400 });
    expect(inferAspectPreset(300, 400)).toBe("portrait");
    expect(inferAspectPreset(400, 300)).toBe("landscape");
  });

  it("places the subject by scale and offset", () => {
    const bbox = { x: 10, y: 10, width: 100, height: 50 };
    const centered = layoutSubject(bbox, {
      ...DEFAULT_COMPOSITION_PARAMS,
      canvasWidth: 200,
      canvasHeight: 200,
      subjectScale: 0.5,
      margin: 0,
      offsetX: 0,
      offsetY: 0,
      subjectLocked: false,
    });
    expect(centered.width).toBeCloseTo(100);
    expect(centered.height).toBeCloseTo(50);
    expect(centered.x + centered.width / 2).toBeCloseTo(100);

    const shifted = layoutSubject(bbox, {
      ...DEFAULT_COMPOSITION_PARAMS,
      canvasWidth: 200,
      canvasHeight: 200,
      subjectScale: 0.5,
      margin: 0,
      offsetX: 0.1,
      offsetY: 0,
      subjectLocked: false,
    });
    expect(shifted.x).toBeGreaterThan(centered.x);
  });

  it("round-trips named positions", () => {
    const up = offsetsForPosition("up");
    expect(up).not.toBeNull();
    expect(inferPositionPreset(up?.offsetX ?? 0, up?.offsetY ?? 0)).toBe("up");
    expect(offsetsForPosition("free")).toBeNull();
  });
});
