/**
 * S11 · 视口变换。缩放 / 平移只改 view；逐格编辑通过 cellAtScreen 另写 cells。
 */

export interface ViewTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export const MIN_SCALE = 1;
export const MAX_SCALE = 64;
export const GRID_MIN_SCALE = 8;
export const CODE_MIN_SCALE = 16;
export const ZOOM_STEP = 1.25;

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return MIN_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function shouldDrawGrid(scale: number, showGrid: boolean): boolean {
  return showGrid && scale >= GRID_MIN_SCALE;
}

export function canShowCodes(scale: number): boolean {
  return scale >= CODE_MIN_SCALE;
}

export function visibleCellRange(
  patternWidth: number,
  patternHeight: number,
  view: ViewTransform,
  viewport: ViewportSize,
): { x0: number; y0: number; x1: number; y1: number } {
  const scale = view.scale <= 0 ? MIN_SCALE : view.scale;
  const x0 = Math.max(0, Math.floor(-view.offsetX / scale) - 1);
  const y0 = Math.max(0, Math.floor(-view.offsetY / scale) - 1);
  const x1 = Math.min(patternWidth, Math.ceil((viewport.width - view.offsetX) / scale) + 1);
  const y1 = Math.min(patternHeight, Math.ceil((viewport.height - view.offsetY) / scale) + 1);
  return { x0, y0, x1, y1 };
}

export function applyPan(view: ViewTransform, dx: number, dy: number): ViewTransform {
  return { scale: view.scale, offsetX: view.offsetX + dx, offsetY: view.offsetY + dy };
}

export function zoomAt(
  view: ViewTransform,
  anchorX: number,
  anchorY: number,
  nextScale: number,
): ViewTransform {
  const scale = clampScale(nextScale);
  const worldX = (anchorX - view.offsetX) / view.scale;
  const worldY = (anchorY - view.offsetY) / view.scale;
  return {
    scale,
    offsetX: anchorX - worldX * scale,
    offsetY: anchorY - worldY * scale,
  };
}

export function fitView(
  patternWidth: number,
  patternHeight: number,
  viewport: ViewportSize,
  padding = 16,
): ViewTransform {
  const availW = Math.max(1, viewport.width - padding * 2);
  const availH = Math.max(1, viewport.height - padding * 2);
  const scale = clampScale(
    Math.min(availW / Math.max(1, patternWidth), availH / Math.max(1, patternHeight)),
  );
  const offsetX = (viewport.width - patternWidth * scale) / 2;
  const offsetY = (viewport.height - patternHeight * scale) / 2;
  return { scale, offsetX, offsetY };
}

export function identityView(): ViewTransform {
  return { scale: 12, offsetX: 16, offsetY: 16 };
}
