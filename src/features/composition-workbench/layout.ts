import type { BBox, CompositionParams } from "../../core/subject";
import { DEFAULT_COMPOSITION_PARAMS } from "../../core/subject";

export type AspectPreset = "square" | "portrait" | "landscape";
export type PositionPreset = "center" | "up" | "down" | "left" | "right" | "free";

/** 主体占比预设；100% = 主体最长边顶满画布内容区短边（配合 0 边距即铺满画板）。 */
export const SCALE_PRESETS = [0.6, 0.7, 0.8, 0.9, 1.0] as const;

export function canvasSizeForAspect(
  preset: AspectPreset,
  longSide = 512,
): { width: number; height: number } {
  if (preset === "portrait") return { width: Math.round(longSide * 0.75), height: longSide };
  if (preset === "landscape") return { width: longSide, height: Math.round(longSide * 0.75) };
  return { width: longSide, height: longSide };
}

export function offsetsForPosition(
  preset: PositionPreset,
): { offsetX: number; offsetY: number } | null {
  switch (preset) {
    case "center":
      return { offsetX: 0, offsetY: 0 };
    case "up":
      return { offsetX: 0, offsetY: -0.16 };
    case "down":
      return { offsetX: 0, offsetY: 0.16 };
    case "left":
      return { offsetX: -0.16, offsetY: 0 };
    case "right":
      return { offsetX: 0.16, offsetY: 0 };
    default:
      return null;
  }
}

export function inferPositionPreset(offsetX: number, offsetY: number): PositionPreset {
  const near = (value: number, target: number) => Math.abs(value - target) < 0.02;
  if (near(offsetX, 0) && near(offsetY, 0)) return "center";
  if (near(offsetX, 0) && near(offsetY, -0.16)) return "up";
  if (near(offsetX, 0) && near(offsetY, 0.16)) return "down";
  if (near(offsetX, -0.16) && near(offsetY, 0)) return "left";
  if (near(offsetX, 0.16) && near(offsetY, 0)) return "right";
  return "free";
}

export function inferAspectPreset(width: number, height: number): AspectPreset {
  const ratio = width / height;
  if (Math.abs(ratio - 1) < 0.05) return "square";
  return ratio < 1 ? "portrait" : "landscape";
}

export interface SubjectLayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 把主体 bbox 按占比 / 偏移放到画布上（纯函数，C3 引擎落地前的 UI 预览几何）。 */
export function layoutSubject(bbox: BBox, params: CompositionParams): SubjectLayoutRect {
  const contentW = params.canvasWidth * (1 - 2 * params.margin);
  const contentH = params.canvasHeight * (1 - 2 * params.margin);
  const longest = Math.max(bbox.width, bbox.height, 1);
  const scale = (params.subjectScale * Math.min(contentW, contentH)) / longest;
  const width = bbox.width * scale;
  const height = bbox.height * scale;
  const cx = params.canvasWidth / 2 + params.offsetX * params.canvasWidth;
  const cy = params.canvasHeight / 2 + params.offsetY * params.canvasHeight;
  return {
    x: cx - width / 2,
    y: cy - height / 2,
    width,
    height,
  };
}

export function clampScale(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_COMPOSITION_PARAMS.subjectScale;
  return Math.min(1, Math.max(0.3, value));
}

export function clampOffset(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(-1, value));
}

export function editingParams(
  base: CompositionParams = DEFAULT_COMPOSITION_PARAMS,
): CompositionParams {
  return { ...base, subjectLocked: false };
}
