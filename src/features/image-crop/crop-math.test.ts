import { describe, expect, it } from "vitest";
import { clampCrop, computeAutoCrop, containInnerGrid, fitRectToAspect } from "./crop-math";

describe("clampCrop", () => {
  it("把越界矩形推回源图内并取整", () => {
    expect(clampCrop({ x: -20, y: 590, width: 200, height: 100 }, 800, 600)).toEqual({
      x: 0,
      y: 500,
      width: 200,
      height: 100,
    });
  });

  it("宽高下限为 1px", () => {
    expect(clampCrop({ x: 10, y: 10, width: 0, height: -5 }, 800, 600)).toEqual({
      x: 10,
      y: 10,
      width: 1,
      height: 1,
    });
  });
});

describe("computeAutoCrop", () => {
  it("fill：800×600 适配 1:1 → 居中 600×600", () => {
    expect(computeAutoCrop(800, 600, 1, "fill")).toEqual({ x: 100, y: 0, width: 600, height: 600 });
  });

  it("fill：800×600 适配 16:9 → 居中 800×450", () => {
    expect(computeAutoCrop(800, 600, 16 / 9, "fill")).toEqual({
      x: 0,
      y: 75,
      width: 800,
      height: 450,
    });
  });

  it("contain：保留整张源图（留白交给采样装配层）", () => {
    expect(computeAutoCrop(800, 600, 1, "contain")).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    });
  });
});

describe("fitRectToAspect", () => {
  it("在现有矩形内收缩到 1:1", () => {
    expect(fitRectToAspect({ x: 0, y: 0, width: 400, height: 200 }, 1, 800, 600)).toEqual({
      x: 100,
      y: 0,
      width: 200,
      height: 200,
    });
  });
});

describe("containInnerGrid", () => {
  it("4:3 内容装入 50×50 → 50×38，垂直居中", () => {
    expect(containInnerGrid(50, 50, 400, 300)).toEqual({
      width: 50,
      height: 38,
      offsetX: 0,
      offsetY: 6,
    });
  });

  it("3:4 内容装入 50×50 → 38×50，水平居中", () => {
    expect(containInnerGrid(50, 50, 300, 400)).toEqual({
      width: 38,
      height: 50,
      offsetX: 6,
      offsetY: 0,
    });
  });

  it("极端比例也不会出现 0 格", () => {
    const inner = containInnerGrid(10, 10, 10000, 1);
    expect(inner.width).toBeGreaterThanOrEqual(1);
    expect(inner.height).toBeGreaterThanOrEqual(1);
  });
});
