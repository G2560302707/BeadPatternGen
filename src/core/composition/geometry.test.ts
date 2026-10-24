import { describe, expect, it } from "vitest";
import { DEFAULT_COMPOSITION_PARAMS } from "../subject";
import type { BBox, CompositionParams } from "../subject";
import {
  COMPOSITION_ALGORITHM_VERSION,
  COMPOSITION_POSITION_PRESETS,
  CompositionError,
  computeCompositionPlan,
} from "./index";
import type { CompositionErrorCode } from "./index";

function params(overrides: Partial<CompositionParams> = {}): CompositionParams {
  return { ...DEFAULT_COMPOSITION_PARAMS, ...overrides };
}

function captureError(action: () => unknown): CompositionError {
  try {
    action();
  } catch (error) {
    if (error instanceof CompositionError) return error;
    throw error;
  }
  throw new Error("expected CompositionError, but no error was thrown");
}

function expectCode(code: CompositionErrorCode, action: () => unknown): void {
  expect(captureError(action).code).toBe(code);
}

const FULL_2x2: BBox = { x: 0, y: 0, width: 2, height: 2 };

describe("computeCompositionPlan · 占比与定位", () => {
  it("正方形画布：subjectScale 相对内容区短边换算", () => {
    const plan = computeCompositionPlan(
      200,
      100,
      { x: 50, y: 25, width: 40, height: 20 },
      params({ canvasWidth: 100, canvasHeight: 100, subjectScale: 0.5, margin: 0 }),
    );
    expect(plan.contentRect).toEqual({ x: 0, y: 0, width: 100, height: 100 });
    expect(plan.crop).toEqual({ x: 50, y: 25, width: 40, height: 20 });
    expect(plan.scale).toBe(1.25);
    expect(plan.subjectRect).toEqual({ x: 25, y: 37.5, width: 50, height: 25 });
    expect(plan.desiredRect).toEqual(plan.subjectRect);
    expect(plan.adjusted).toBe(false);
    expect(plan.overflow).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
    expect(plan.algorithmVersion).toBe(COMPOSITION_ALGORITHM_VERSION);
  });

  it("margin 按 min(画布宽, 高) 换算并收缩内容区", () => {
    const plan = computeCompositionPlan(
      100,
      100,
      { x: 0, y: 0, width: 40, height: 20 },
      params({ canvasWidth: 100, canvasHeight: 100, subjectScale: 0.5, margin: 0.1 }),
    );
    expect(plan.contentRect).toEqual({ x: 10, y: 10, width: 80, height: 80 });
    expect(plan.scale).toBe(1);
    expect(plan.subjectRect).toEqual({ x: 30, y: 40, width: 40, height: 20 });
  });

  it("竖版画布：主体按短边（宽）定位，仍居中", () => {
    const plan = computeCompositionPlan(
      100,
      100,
      { x: 0, y: 0, width: 40, height: 20 },
      params({ canvasWidth: 100, canvasHeight: 200, subjectScale: 0.5, margin: 0 }),
    );
    expect(plan.scale).toBe(1.25);
    expect(plan.subjectRect).toEqual({ x: 25, y: 87.5, width: 50, height: 25 });
  });

  it("横版画布：主体最长边对齐内容区短边（高）", () => {
    const plan = computeCompositionPlan(
      100,
      100,
      { x: 0, y: 0, width: 10, height: 10 },
      params({ canvasWidth: 200, canvasHeight: 100, subjectScale: 0.7, margin: 0 }),
    );
    expect(plan.scale).toBe(7);
    expect(plan.subjectRect).toEqual({ x: 65, y: 15, width: 70, height: 70 });
  });

  it("offset 单位是画布宽 / 高，正值向右 / 向下", () => {
    const plan = computeCompositionPlan(
      200,
      100,
      { x: 0, y: 0, width: 20, height: 20 },
      params({
        canvasWidth: 200,
        canvasHeight: 100,
        subjectScale: 0.5,
        offsetX: 0.25,
        offsetY: -0.1,
        margin: 0,
      }),
    );
    // 主体 50×50，中心 (100,50) + (50, -10) = (150, 40) → 左上角 (125, 15)。
    expect(plan.subjectRect).toEqual({ x: 125, y: 15, width: 50, height: 50 });
    expect(plan.adjusted).toBe(false);
    expect(plan.suggestion).toEqual({ offsetX: 0.25, offsetY: -0.1 });
  });
});

describe("computeCompositionPlan · 定位预设", () => {
  const base = params({
    canvasWidth: 100,
    canvasHeight: 100,
    subjectScale: 0.5,
    margin: 0.1,
  });
  const bbox: BBox = { x: 0, y: 0, width: 20, height: 10 };

  function place(preset: { offsetX: number; offsetY: number }) {
    return computeCompositionPlan(100, 100, bbox, { ...base, ...preset });
  }

  it("预设使用极端 offset，由几何夹紧到内容区四边", () => {
    // 内容区 {10,10,80,80}；主体 40×20。
    expect(place(COMPOSITION_POSITION_PRESETS.center).subjectRect).toEqual({
      x: 30,
      y: 40,
      width: 40,
      height: 20,
    });
    expect(place(COMPOSITION_POSITION_PRESETS.top).subjectRect.y).toBe(10);
    expect(place(COMPOSITION_POSITION_PRESETS.bottom).subjectRect.y).toBe(70);
    expect(place(COMPOSITION_POSITION_PRESETS.left).subjectRect.x).toBe(10);
    expect(place(COMPOSITION_POSITION_PRESETS.right).subjectRect.x).toBe(50);
  });

  it("被夹紧的预设会标记 adjusted", () => {
    expect(place(COMPOSITION_POSITION_PRESETS.center).adjusted).toBe(false);
    for (const preset of [
      COMPOSITION_POSITION_PRESETS.top,
      COMPOSITION_POSITION_PRESETS.bottom,
      COMPOSITION_POSITION_PRESETS.left,
      COMPOSITION_POSITION_PRESETS.right,
    ]) {
      expect(place(preset).adjusted).toBe(true);
    }
  });
});

describe("computeCompositionPlan · 超界修正", () => {
  it("offset 过大时夹紧到内容区，并给出可修正建议", () => {
    const plan = computeCompositionPlan(
      100,
      100,
      { x: 0, y: 0, width: 40, height: 20 },
      params({
        canvasWidth: 100,
        canvasHeight: 100,
        subjectScale: 0.5,
        offsetX: 0.9,
        margin: 0.1,
      }),
    );
    // 期望 x = 50 + 90 - 20 = 120；内容区右边界允许的最大 x = 10 + 80 - 40 = 50。
    expect(plan.desiredRect.x).toBe(120);
    expect(plan.subjectRect).toEqual({ x: 50, y: 40, width: 40, height: 20 });
    expect(plan.adjusted).toBe(true);
    expect(plan.suggestion).toEqual({ offsetX: 0.2, offsetY: 0 });
    expect(plan.overflow).toEqual({ left: 0, top: 0, right: 60, bottom: 0 });
  });

  it("任意合法 offset 都不会让主体越出内容区", () => {
    for (const offsetX of [-1, -0.7, 0, 0.7, 1]) {
      for (const offsetY of [-1, 0, 1]) {
        const plan = computeCompositionPlan(
          120,
          80,
          { x: 10, y: 10, width: 60, height: 40 },
          params({
            canvasWidth: 120,
            canvasHeight: 90,
            subjectScale: 0.9,
            offsetX,
            offsetY,
            margin: 0.05,
          }),
        );
        expect(plan.subjectRect.x).toBeGreaterThanOrEqual(plan.contentRect.x - 1e-9);
        expect(plan.subjectRect.y).toBeGreaterThanOrEqual(plan.contentRect.y - 1e-9);
        expect(plan.subjectRect.x + plan.subjectRect.width).toBeLessThanOrEqual(
          plan.contentRect.x + plan.contentRect.width + 1e-9,
        );
        expect(plan.subjectRect.y + plan.subjectRect.height).toBeLessThanOrEqual(
          plan.contentRect.y + plan.contentRect.height + 1e-9,
        );
      }
    }
  });

  it("margin 为 0.5 的正方形画布没有内容区", () => {
    expectCode("E_MARGIN_TOO_LARGE", () =>
      computeCompositionPlan(
        100,
        100,
        FULL_2x2,
        params({ canvasWidth: 100, canvasHeight: 100, margin: 0.5 }),
      ),
    );
  });
});

describe("computeCompositionPlan · 校验", () => {
  it("bbox 超出源图时报 E_BBOX_INVALID", () => {
    expectCode("E_BBOX_INVALID", () =>
      computeCompositionPlan(100, 100, { x: 90, y: 90, width: 20, height: 20 }, params()),
    );
  });

  it("bbox 非整数时报 E_BBOX_INVALID", () => {
    expectCode("E_BBOX_INVALID", () =>
      computeCompositionPlan(100, 100, { x: 0.5, y: 0, width: 10, height: 10 }, params()),
    );
  });

  it("参数非法时报 E_PARAMS_INVALID", () => {
    expectCode("E_PARAMS_INVALID", () =>
      computeCompositionPlan(100, 100, FULL_2x2, params({ subjectScale: 0 })),
    );
    expectCode("E_PARAMS_INVALID", () =>
      computeCompositionPlan(
        100,
        100,
        FULL_2x2,
        params({ backgroundType: "solid", backgroundValue: null }),
      ),
    );
  });

  it("源图尺寸非法时报 E_SOURCE_INVALID", () => {
    expectCode("E_SOURCE_INVALID", () => computeCompositionPlan(0, 100, FULL_2x2, params()));
    expectCode("E_SOURCE_INVALID", () => computeCompositionPlan(10.5, 100, FULL_2x2, params()));
  });
});
