import { describe, expect, it } from "vitest";
import { DEFAULT_MASK_THRESHOLD, computeMaskBBox } from "../../core/subject";
import {
  brushValue,
  commitMaskEdit,
  createEmptyCandidate,
  fillBox,
  paintStroke,
  stampDisk,
} from "./brush";

describe("mask brush", () => {
  it("adds a disk and recomputes bbox via C2", () => {
    const candidate = createEmptyCandidate("img", 20, 16);
    expect(computeMaskBBox(candidate.mask)).toBeNull();
    stampDisk(candidate.mask.data, 20, 16, 8, 6, 3, brushValue("add"));
    const next = commitMaskEdit(candidate, candidate.mask.data);
    expect(next.bbox.x).toBeLessThanOrEqual(8);
    expect(next.bbox.y).toBeLessThanOrEqual(6);
    expect(next.bbox.x + next.bbox.width).toBeGreaterThan(8);
    expect(next.bbox.y + next.bbox.height).toBeGreaterThan(6);
    expect(computeMaskBBox(next.mask)?.width).toBe(next.bbox.width);
  });

  it("erases previously added pixels", () => {
    const candidate = createEmptyCandidate("img", 12, 12);
    stampDisk(candidate.mask.data, 12, 12, 6, 6, 4, 255);
    paintStroke(candidate.mask.data, 12, 12, 6, 6, 6, 6, 5, brushValue("erase"));
    const next = commitMaskEdit(candidate, candidate.mask.data);
    expect(computeMaskBBox(next.mask)).toBeNull();
    expect(next.bbox).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it("fills a dragged rectangle for manual box select", () => {
    const candidate = createEmptyCandidate("img", 10, 8);
    fillBox(candidate.mask.data, 10, 8, 2, 1, 5, 3, 255);
    const next = commitMaskEdit(candidate, candidate.mask.data);
    expect(next.bbox).toEqual({ x: 2, y: 1, width: 4, height: 3 });
  });

  it("keeps mask encoding and threshold from the C1 contract", () => {
    const candidate = createEmptyCandidate("src-1", 8, 8);
    expect(candidate.mask.encoding).toBe("raw-alpha8");
    expect(candidate.mask.threshold).toBe(DEFAULT_MASK_THRESHOLD);
    expect(candidate.mask.data).toHaveLength(64);
    expect(candidate.label).toBe("main-subject");
  });
});
