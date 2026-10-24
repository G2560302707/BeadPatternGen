import { describe, expect, it } from "vitest";
import { computeCompositionPlan } from "../../core/composition";
import { DEFAULT_COMPOSITION_PARAMS } from "../../core/subject";
import { describeOverflow, hasOverflow } from "./overflow-hint";

describe("overflow-hint", () => {
  it("is silent when the subject sits inside the canvas", () => {
    const plan = computeCompositionPlan(
      100,
      100,
      { x: 0, y: 0, width: 40, height: 20 },
      {
        ...DEFAULT_COMPOSITION_PARAMS,
        canvasWidth: 100,
        canvasHeight: 100,
        subjectScale: 0.5,
        margin: 0.1,
        subjectLocked: false,
      },
    );
    expect(hasOverflow(plan)).toBe(false);
    expect(describeOverflow(plan)).toBeNull();
  });

  it("quotes C3 overflow sides and suggestion remains consumable", () => {
    const plan = computeCompositionPlan(
      100,
      100,
      { x: 0, y: 0, width: 40, height: 20 },
      {
        ...DEFAULT_COMPOSITION_PARAMS,
        canvasWidth: 100,
        canvasHeight: 100,
        subjectScale: 0.5,
        offsetX: 0.9,
        margin: 0.1,
        subjectLocked: false,
      },
    );
    expect(hasOverflow(plan)).toBe(true);
    expect(plan.overflow.right).toBe(60);
    expect(describeOverflow(plan)).toContain("右 60px");
    expect(plan.suggestion).toEqual({ offsetX: 0.2, offsetY: 0 });
  });
});
