import { describe, expect, it } from "vitest";
import { assessMaskQuality } from "./quality-gate";
import type { SubjectMask } from "./types";

function mask(width: number, height: number, threshold: number): SubjectMask {
  return {
    sourceImageId: "img-1",
    width,
    height,
    encoding: "raw-alpha8",
    data: new Uint8ClampedArray(width * height),
    threshold,
    model: { id: "u2netp", version: "test" },
    createdAt: "2026-10-24T00:00:00.000Z",
  };
}

describe("assessMaskQuality", () => {
  it("normal masks pass without warning", () => {
    const m = mask(4, 4, 128);
    for (const index of [5, 6, 9, 10]) m.data[index] = 255;
    const assessment = assessMaskQuality(m, { x: 1, y: 1, width: 2, height: 2 });
    expect(assessment.foregroundRatio).toBeCloseTo(4 / 16);
    expect(assessment.edgeContacts).toBe(0);
    expect(assessment.suspicious).toBe(false);
    expect(assessment.warning).toBeNull();
  });

  it("flags inflated foreground ratio", () => {
    const m = mask(10, 10, 128);
    m.data.fill(255);
    const assessment = assessMaskQuality(m, { x: 0, y: 0, width: 10, height: 10 });
    expect(assessment.foregroundRatio).toBe(1);
    expect(assessment.suspicious).toBe(true);
    expect(assessment.warning).toContain("前景占比");
    expect(assessment.warning).toContain("高精度");
  });

  it("flags bbox touching two edges even with modest foreground", () => {
    const m = mask(10, 10, 128);
    for (let i = 0; i < 30; i += 1) m.data[i] = 255; // 30% 前景
    const assessment = assessMaskQuality(m, { x: 0, y: 0, width: 9, height: 3 });
    expect(assessment.edgeContacts).toBe(2);
    expect(assessment.suspicious).toBe(true);
    expect(assessment.warning).toContain("2 条边");
  });

  it("a single-edge touch is tolerated", () => {
    const m = mask(10, 10, 128);
    for (let row = 0; row < 4; row += 1) {
      for (let col = 3; col < 8; col += 1) m.data[row * 10 + col] = 255;
    }
    const assessment = assessMaskQuality(m, { x: 3, y: 0, width: 5, height: 4 });
    expect(assessment.edgeContacts).toBe(1);
    expect(assessment.suspicious).toBe(false);
  });
});
