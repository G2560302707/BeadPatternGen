import { useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { SubjectCandidate } from "../../core/subject";
import type { ImageSession } from "../../state/workspace-store";
import {
  brushValue,
  clampBrushRadius,
  cloneMaskData,
  fillBox,
  paintStroke,
  type BrushMode,
} from "./brush";

const MAX_SIDE = 280;

function fitOverlaySize(
  width: number,
  height: number,
): { width: number; height: number; scale: number } {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height, 1));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

function paintMask(
  ctx: CanvasRenderingContext2D,
  image: ImageSession,
  mask: SubjectCandidate["mask"] | null,
  display: { width: number; height: number; scale: number },
  bbox: SubjectCandidate["bbox"] | null,
  cursor: { x: number; y: number; radius: number } | null,
  box: { x0: number; y0: number; x1: number; y1: number } | null,
): void {
  ctx.clearRect(0, 0, display.width, display.height);
  ctx.drawImage(image.bitmap, 0, 0, display.width, display.height);
  if (mask) {
    const overlay = ctx.getImageData(0, 0, display.width, display.height);
    for (let y = 0; y < display.height; y += 1) {
      for (let x = 0; x < display.width; x += 1) {
        const sx = Math.min(mask.width - 1, Math.floor(x / display.scale));
        const sy = Math.min(mask.height - 1, Math.floor(y / display.scale));
        const alpha = mask.data[sy * mask.width + sx] ?? 0;
        if (alpha <= mask.threshold) continue;
        const i = (y * display.width + x) * 4;
        overlay.data[i] = Math.round((overlay.data[i] ?? 0) * 0.45 + 182 * 0.55);
        overlay.data[i + 1] = Math.round((overlay.data[i + 1] ?? 0) * 0.45 + 25 * 0.55);
        overlay.data[i + 2] = Math.round((overlay.data[i + 2] ?? 0) * 0.45 + 39 * 0.55);
      }
    }
    ctx.putImageData(overlay, 0, 0);
  }
  if (bbox) {
    ctx.strokeStyle = "rgba(0,152,195,0.95)";
    ctx.lineWidth = 2;
    ctx.strokeRect(bbox.x * display.scale, bbox.y * display.scale, bbox.width * display.scale, bbox.height * display.scale);
  }
  if (box) {
    const x = Math.min(box.x0, box.x1) * display.scale;
    const y = Math.min(box.y0, box.y1) * display.scale;
    const w = Math.abs(box.x1 - box.x0) * display.scale;
    const h = Math.abs(box.y1 - box.y0) * display.scale;
    ctx.strokeStyle = "rgba(0,152,195,0.95)";
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(0,152,195,0.18)";
    ctx.fillRect(x, y, w, h);
  }
  if (cursor && !box) {
    ctx.beginPath();
    ctx.strokeStyle = "rgba(12,28,44,0.85)";
    ctx.lineWidth = 1;
    ctx.arc(cursor.x, cursor.y, Math.max(2, cursor.radius * display.scale), 0, Math.PI * 2);
    ctx.stroke();
  }
}

export function MaskCanvas({
  image,
  candidate,
  mode,
  radius,
  enabled,
  onStrokeEnd,
}: {
  image: ImageSession;
  candidate: SubjectCandidate | null;
  mode: BrushMode;
  radius: number;
  enabled: boolean;
  onStrokeEnd: (previous: SubjectCandidate, data: Uint8ClampedArray) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workingRef = useRef<Uint8ClampedArray | null>(null);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const boxRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const previousRef = useRef<SubjectCandidate | null>(null);

  const display = fitOverlaySize(image.width, image.height);
  const brushRadius = clampBrushRadius(radius);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const size = fitOverlaySize(image.width, image.height);
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const live = workingRef.current;
    const mask = live && candidate ? { ...candidate.mask, data: live } : (candidate?.mask ?? null);
    paintMask(ctx, image, mask, size, candidate?.bbox ?? null, null, null);
  }, [image, candidate]);

  const sourcePoint = (clientX: number, clientY: number): { x: number; y: number; dx: number; dy: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const box = canvas.getBoundingClientRect();
    const dx = ((clientX - box.left) * canvas.width) / Math.max(1, box.width);
    const dy = ((clientY - box.top) * canvas.height) / Math.max(1, box.height);
    return { x: dx / display.scale, y: dy / display.scale, dx, dy };
  };

  const paintLive = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const live = workingRef.current;
    const mask = live && candidate ? { ...candidate.mask, data: live } : candidate?.mask ?? null;
    const cursor = cursorRef.current;
    paintMask(
      ctx,
      image,
      mask,
      display,
      candidate?.bbox ?? null,
      cursor && enabled ? { x: cursor.x, y: cursor.y, radius: brushRadius } : null,
      boxRef.current,
    );
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!enabled || !candidate) return;
    const point = sourcePoint(event.clientX, event.clientY);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    previousRef.current = candidate;
    workingRef.current = cloneMaskData(candidate.mask);
    lastRef.current = { x: point.x, y: point.y };
    cursorRef.current = { x: point.dx, y: point.dy };
    if (mode === "box") {
      boxRef.current = { x0: point.x, y0: point.y, x1: point.x, y1: point.y };
      paintLive();
      return;
    }
    paintStroke(
      workingRef.current,
      candidate.mask.width,
      candidate.mask.height,
      point.x,
      point.y,
      point.x,
      point.y,
      brushRadius,
      brushValue(mode),
    );
    paintLive();
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = sourcePoint(event.clientX, event.clientY);
    if (point) cursorRef.current = { x: point.dx, y: point.dy };
    const working = workingRef.current;
    const last = lastRef.current;
    if (!enabled || !candidate || !working || !last || !point) {
      if (enabled) paintLive();
      return;
    }
    if (mode === "box") {
      boxRef.current = { x0: last.x, y0: last.y, x1: point.x, y1: point.y };
      paintLive();
      return;
    }
    paintStroke(
      working,
      candidate.mask.width,
      candidate.mask.height,
      last.x,
      last.y,
      point.x,
      point.y,
      brushRadius,
      brushValue(mode),
    );
    lastRef.current = { x: point.x, y: point.y };
    paintLive();
  };

  const endStroke = () => {
    const working = workingRef.current;
    const previous = previousRef.current;
    const box = boxRef.current;
    workingRef.current = null;
    lastRef.current = null;
    previousRef.current = null;
    boxRef.current = null;
    if (!working || !previous) {
      paintLive();
      return;
    }
    if (mode === "box" && box) {
      fillBox(
        working,
        previous.mask.width,
        previous.mask.height,
        box.x0,
        box.y0,
        box.x1,
        box.y1,
        255,
      );
    }
    onStrokeEnd(previous, working);
  };

  return (
    <canvas
      ref={canvasRef}
      className={enabled ? "subject-overlay subject-overlay--brush" : "subject-overlay"}
      data-testid="mask-canvas"
      aria-label="原图与主体蒙版画笔"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endStroke}
      onPointerCancel={endStroke}
      onPointerLeave={() => {
        cursorRef.current = null;
        if (!workingRef.current) paintLive();
      }}
    />
  );
}
