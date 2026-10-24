import { useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { computeCompositionPlan } from "../../core/composition";
import { useWorkspaceStore } from "../../state/workspace-store";
import { COMPOSE_HANDLE_SIZE, paintCompositionPreview } from "./compose-preview";
import { clampOffset, clampScale, inferPositionPreset } from "./layout";

type DragMode = "move" | "scale";

interface DragState {
  mode: DragMode;
  pointerId: number;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  scale: number;
  centerX: number;
  centerY: number;
  startDist: number;
}

function canvasPoint(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const box = canvas.getBoundingClientRect();
  const sx = canvas.width / Math.max(1, box.width);
  const sy = canvas.height / Math.max(1, box.height);
  return { x: (clientX - box.left) * sx, y: (clientY - box.top) * sy };
}

export function CompositionCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const image = useWorkspaceStore((state) => state.image);
  const candidates = useWorkspaceStore((state) => state.subjectCandidates);
  const selectedId = useWorkspaceStore((state) => state.selectedSubjectId);
  const params = useWorkspaceStore((state) => state.compositionParams);
  const backgroundImage = useWorkspaceStore((state) => state.compositionBackgroundImage);
  const patchCompositionParams = useWorkspaceStore((state) => state.patchCompositionParams);
  const setCompositionPosition = useWorkspaceStore((state) => state.setCompositionPosition);

  const candidate = candidates.find((item) => item.id === selectedId) ?? candidates[0] ?? null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    canvas.width = params.canvasWidth;
    canvas.height = params.canvasHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (!candidate) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    let cancelled = false;
    let bitmap: ImageBitmap | null = null;
    const draw = (bg: { source: CanvasImageSource; width: number; height: number } | null) => {
      if (cancelled || !ctx) return;
      paintCompositionPreview(
        ctx,
        image.bitmap,
        image.width,
        image.height,
        candidate,
        params,
        true,
        bg,
      );
    };
    const run = async () => {
      if (params.backgroundType === "image" && backgroundImage) {
        bitmap = await createImageBitmap(
          new ImageData(backgroundImage.data, backgroundImage.width, backgroundImage.height),
        );
        if (cancelled) {
          bitmap.close();
          return;
        }
        draw({ source: bitmap, width: backgroundImage.width, height: backgroundImage.height });
        return;
      }
      draw(null);
    };
    void run();
    return () => {
      cancelled = true;
      bitmap?.close();
    };
  }, [image, candidate, params, backgroundImage]);

  if (!image) return null;

  const hitTest = (x: number, y: number): DragMode | null => {
    if (!candidate || params.subjectLocked) return null;
    const dest = computeCompositionPlan(
      image.width,
      image.height,
      candidate.bbox,
      params,
    ).subjectRect;
    const handle = {
      x: dest.x + dest.width - COMPOSE_HANDLE_SIZE,
      y: dest.y + dest.height - COMPOSE_HANDLE_SIZE,
    };
    if (
      x >= handle.x &&
      x <= handle.x + COMPOSE_HANDLE_SIZE &&
      y >= handle.y &&
      y <= handle.y + COMPOSE_HANDLE_SIZE
    ) {
      return "scale";
    }
    if (x >= dest.x && x <= dest.x + dest.width && y >= dest.y && y <= dest.y + dest.height) {
      return "move";
    }
    return null;
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !candidate || params.subjectLocked) return;
    const point = canvasPoint(canvas, event.clientX, event.clientY);
    const mode = hitTest(point.x, point.y);
    if (!mode) return;
    const dest = computeCompositionPlan(
      image.width,
      image.height,
      candidate.bbox,
      params,
    ).subjectRect;
    const centerX = dest.x + dest.width / 2;
    const centerY = dest.y + dest.height / 2;
    dragRef.current = {
      mode,
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      offsetX: params.offsetX,
      offsetY: params.offsetY,
      scale: params.subjectScale,
      centerX,
      centerY,
      startDist: Math.hypot(point.x - centerX, point.y - centerY) || 1,
    };
    canvas.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const drag = dragRef.current;
    if (!canvas || !drag || drag.pointerId !== event.pointerId) return;
    const point = canvasPoint(canvas, event.clientX, event.clientY);
    if (drag.mode === "move") {
      const offsetX = clampOffset(drag.offsetX + (point.x - drag.startX) / params.canvasWidth);
      const offsetY = clampOffset(drag.offsetY + (point.y - drag.startY) / params.canvasHeight);
      patchCompositionParams({ offsetX, offsetY });
      setCompositionPosition(inferPositionPreset(offsetX, offsetY));
      return;
    }
    const dist = Math.hypot(point.x - drag.centerX, point.y - drag.centerY);
    patchCompositionParams({ subjectScale: clampScale(drag.scale * (dist / drag.startDist)) });
  };

  const endDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  };

  const onWheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    if (params.subjectLocked || !candidate) return;
    event.preventDefault();
    patchCompositionParams({
      subjectScale: clampScale(params.subjectScale - event.deltaY * 0.001),
    });
  };

  return (
    <div className="compose-canvas-wrap">
      <canvas
        ref={canvasRef}
        className="compose-canvas"
        data-testid="composition-canvas"
        aria-label="构图预览"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={onWheel}
      />
      <p className="hint">
        {candidate
          ? params.subjectLocked
            ? "主体已锁定，可改背景与边距，确认后进入生成。"
            : "拖动主体、滚轮或右下角手柄缩放。透明区域显示为棋盘格。"
          : "等待主体识别完成后即可构图。"}
      </p>
    </div>
  );
}
