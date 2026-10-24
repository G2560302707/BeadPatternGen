import { computeCompositionPlan } from "../../core/composition";
import type { CompositionParams, SubjectCandidate } from "../../core/subject";

const overlayCache = new WeakMap<SubjectCandidate, HTMLCanvasElement>();

export function paintCheckerboard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const size = 12;
  for (let y = 0; y < height; y += size) {
    for (let x = 0; x < width; x += size) {
      const odd = ((x / size) | 0) + ((y / size) | 0);
      ctx.fillStyle = odd % 2 === 0 ? "#eef4f8" : "#dce7ef";
      ctx.fillRect(x, y, size, size);
    }
  }
}

export const COMPOSE_HANDLE_SIZE = 10;

export function subjectOverlayCanvas(
  source: CanvasImageSource,
  candidate: SubjectCandidate,
): HTMLCanvasElement | null {
  const cached = overlayCache.get(candidate);
  if (cached) return cached;
  const { bbox, mask } = candidate;
  const overlay = document.createElement("canvas");
  overlay.width = Math.max(1, bbox.width);
  overlay.height = Math.max(1, bbox.height);
  const overlayCtx = overlay.getContext("2d");
  if (!overlayCtx) return null;
  overlayCtx.drawImage(
    source,
    bbox.x,
    bbox.y,
    bbox.width,
    bbox.height,
    0,
    0,
    bbox.width,
    bbox.height,
  );
  const image = overlayCtx.getImageData(0, 0, overlay.width, overlay.height);
  for (let y = 0; y < bbox.height; y += 1) {
    for (let x = 0; x < bbox.width; x += 1) {
      const gx = bbox.x + x;
      const gy = bbox.y + y;
      const alpha = mask.data[gy * mask.width + gx] ?? 0;
      const i = (y * bbox.width + x) * 4;
      image.data[i + 3] = alpha > mask.threshold ? 255 : 0;
    }
  }
  overlayCtx.putImageData(image, 0, 0);
  overlayCache.set(candidate, overlay);
  return overlay;
}

function paintCover(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  width: number,
  height: number,
  canvasW: number,
  canvasH: number,
): void {
  const scale = Math.max(canvasW / Math.max(1, width), canvasH / Math.max(1, height));
  const dw = width * scale;
  const dh = height * scale;
  ctx.drawImage(image, (canvasW - dw) / 2, (canvasH - dh) / 2, dw, dh);
}

export function paintCompositionPreview(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  candidate: SubjectCandidate,
  params: CompositionParams,
  showGuides = true,
  backgroundImage?: { source: CanvasImageSource; width: number; height: number } | null,
): void {
  ctx.clearRect(0, 0, params.canvasWidth, params.canvasHeight);
  if (params.backgroundType === "solid" && params.backgroundValue) {
    ctx.fillStyle = params.backgroundValue;
    ctx.fillRect(0, 0, params.canvasWidth, params.canvasHeight);
  } else if (params.backgroundType === "image" && backgroundImage) {
    paintCover(
      ctx,
      backgroundImage.source,
      backgroundImage.width,
      backgroundImage.height,
      params.canvasWidth,
      params.canvasHeight,
    );
  } else {
    // 透明背景必须用棋盘格，禁止填黑。
    paintCheckerboard(ctx, params.canvasWidth, params.canvasHeight);
  }

  const plan = computeCompositionPlan(sourceWidth, sourceHeight, candidate.bbox, params);
  const dest = plan.subjectRect;
  const overlay = subjectOverlayCanvas(source, candidate);
  if (!overlay) return;
  ctx.drawImage(overlay, dest.x, dest.y, dest.width, dest.height);

  if (!showGuides) return;
  if (plan.adjusted) {
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = "rgba(168, 121, 0, 0.95)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(
      plan.desiredRect.x,
      plan.desiredRect.y,
      plan.desiredRect.width,
      plan.desiredRect.height,
    );
    ctx.restore();
  }
  ctx.strokeStyle = params.subjectLocked ? "rgba(12,28,44,0.28)" : "rgba(0,152,195,0.95)";
  ctx.lineWidth = 2;
  ctx.strokeRect(dest.x, dest.y, dest.width, dest.height);
  if (!params.subjectLocked) {
    ctx.fillStyle = "#0098c3";
    ctx.fillRect(
      dest.x + dest.width - COMPOSE_HANDLE_SIZE,
      dest.y + dest.height - COMPOSE_HANDLE_SIZE,
      COMPOSE_HANDLE_SIZE,
      COMPOSE_HANDLE_SIZE,
    );
  }
}
