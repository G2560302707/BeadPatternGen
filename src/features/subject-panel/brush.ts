import {
  DEFAULT_MASK_THRESHOLD,
  SUBJECT_LABEL_MAIN,
  computeMaskBBox,
  type SubjectCandidate,
  type SubjectMask,
} from "../../core/subject";

export type BrushMode = "add" | "erase" | "box";

export const BRUSH_RADIUS_PRESETS = [4, 8, 16, 32] as const;

export const MAX_UNDO = 20;

export function clampBrushRadius(value: number): number {
  if (!Number.isFinite(value)) return 8;
  return Math.min(64, Math.max(1, Math.round(value)));
}

export function cloneMaskData(mask: SubjectMask): Uint8ClampedArray {
  return new Uint8ClampedArray(mask.data);
}

export function stampDisk(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  value: number,
): void {
  const r = Math.max(1, Math.round(radius));
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx) - r);
  const y0 = Math.max(0, Math.floor(cy) - r);
  const x1 = Math.min(width - 1, Math.floor(cx) + r);
  const y1 = Math.min(height - 1, Math.floor(cy) + r);
  const icx = Math.floor(cx);
  const icy = Math.floor(cy);
  for (let y = y0; y <= y1; y += 1) {
    const dy = y - icy;
    for (let x = x0; x <= x1; x += 1) {
      const dx = x - icx;
      if (dx * dx + dy * dy > r2) continue;
      data[y * width + x] = value;
    }
  }
}

export function paintStroke(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
  value: number,
): void {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(dist));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    stampDisk(data, width, height, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius, value);
  }
}

export function brushValue(mode: BrushMode): number {
  return mode === "erase" ? 0 : 255;
}

export function fillBox(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  value: number,
): void {
  const xa = Math.max(0, Math.floor(Math.min(x0, x1)));
  const xb = Math.min(width - 1, Math.floor(Math.max(x0, x1)));
  const ya = Math.max(0, Math.floor(Math.min(y0, y1)));
  const yb = Math.min(height - 1, Math.floor(Math.max(y0, y1)));
  for (let y = ya; y <= yb; y += 1) {
    const row = y * width;
    for (let x = xa; x <= xb; x += 1) {
      data[row + x] = value;
    }
  }
}

export function commitMaskEdit(candidate: SubjectCandidate, data: Uint8ClampedArray): SubjectCandidate {
  const mask: SubjectMask = {
    ...candidate.mask,
    data: new Uint8ClampedArray(data),
  };
  const bbox = computeMaskBBox(mask) ?? { x: 0, y: 0, width: 1, height: 1 };
  return { ...candidate, mask, bbox };
}

export function createEmptyCandidate(sourceImageId: string, width: number, height: number): SubjectCandidate {
  const createdAt = new Date().toISOString();
  const mask: SubjectMask = {
    sourceImageId,
    width,
    height,
    encoding: "raw-alpha8",
    data: new Uint8ClampedArray(width * height),
    threshold: DEFAULT_MASK_THRESHOLD,
    model: { id: "manual-brush", version: "k5", license: "internal-manual" },
    createdAt,
  };
  return {
    id:
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `manual-${Date.now()}`,
    sourceImageId,
    mask,
    bbox: { x: 0, y: 0, width: 1, height: 1 },
    confidence: 1,
    label: SUBJECT_LABEL_MAIN,
    createdAt,
  };
}
