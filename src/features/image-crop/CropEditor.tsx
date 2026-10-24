import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useWorkspaceStore } from "../../state/workspace-store";
import { clampCrop } from "./crop-math";
import type { CropRect } from "./crop-math";

type Handle = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const FREE_HANDLES: readonly Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const LOCKED_HANDLES: readonly Handle[] = ["nw", "ne", "se", "sw"];

function resizeFree(
  rect: CropRect,
  handle: Handle,
  dx: number,
  dy: number,
  imageWidth: number,
  imageHeight: number,
): CropRect {
  let left = rect.x;
  let right = rect.x + rect.width;
  let top = rect.y;
  let bottom = rect.y + rect.height;

  if (handle.includes("w")) left = Math.min(left + dx, right - 1);
  if (handle.includes("e")) right = Math.max(right + dx, left + 1);
  if (handle.includes("n")) top = Math.min(top + dy, bottom - 1);
  if (handle.includes("s")) bottom = Math.max(bottom + dy, top + 1);

  left = Math.max(0, left);
  top = Math.max(0, top);
  right = Math.min(imageWidth, right);
  bottom = Math.min(imageHeight, bottom);

  return clampCrop(
    { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) },
    imageWidth,
    imageHeight,
  );
}

function resizeLocked(
  rect: CropRect,
  handle: Handle,
  dx: number,
  dy: number,
  ratio: number,
  imageWidth: number,
  imageHeight: number,
): CropRect {
  const east = handle === "ne" || handle === "se";
  const south = handle === "se" || handle === "sw";
  const anchorX = east ? rect.x : rect.x + rect.width;
  const anchorY = south ? rect.y : rect.y + rect.height;
  const pointerX = (east ? rect.x + rect.width : rect.x) + dx;
  const pointerY = (south ? rect.y + rect.height : rect.y) + dy;

  let width = Math.max(1, Math.abs(pointerX - anchorX));
  let height = Math.max(1, Math.abs(pointerY - anchorY));
  if (width / height > ratio) {
    height = width / ratio;
  } else {
    width = height * ratio;
  }

  const maxWidth = east ? imageWidth - anchorX : anchorX;
  const maxHeight = south ? imageHeight - anchorY : anchorY;
  const fit = Math.min(1, maxWidth / width, maxHeight / height);
  width = Math.max(1, width * fit);
  height = Math.max(1, height * fit);

  return clampCrop(
    {
      x: east ? anchorX : anchorX - width,
      y: south ? anchorY : anchorY - height,
      width,
      height,
    },
    imageWidth,
    imageHeight,
  );
}

interface DragState {
  handle: Handle;
  startX: number;
  startY: number;
  rect: CropRect;
}

export function CropEditor() {
  const image = useWorkspaceStore((state) => state.image);
  const crop = useWorkspaceStore((state) => state.crop);
  const aspectMode = useWorkspaceStore((state) => state.aspectMode);
  const lockedRatio = useWorkspaceStore((state) => state.lockedRatio);
  const gridW = useWorkspaceStore((state) => state.gridW);
  const gridH = useWorkspaceStore((state) => state.gridH);
  const setCrop = useWorkspaceStore((state) => state.setCrop);

  const stageRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const update = () => setBox({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const availableWidth = box.width > 0 ? box.width : 640;
  const scale = image ? Math.min(availableWidth / image.width, 420 / image.height, 8) : 1;
  const displayWidth = image ? Math.max(1, Math.round(image.width * scale)) : 0;
  const displayHeight = image ? Math.max(1, Math.round(image.height * scale)) : 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image || displayWidth < 1 || displayHeight < 1) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(displayWidth * dpr));
    canvas.height = Math.max(1, Math.round(displayHeight * dpr));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, displayWidth, displayHeight);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(image.bitmap, 0, 0, displayWidth, displayHeight);
  }, [image, displayWidth, displayHeight]);

  if (!image || !crop) return null;

  const ratio =
    aspectMode === "free" ? null : aspectMode === "locked" ? lockedRatio : gridW / gridH;

  const toSource = (event: ReactPointerEvent<HTMLDivElement>): { x: number; y: number } => {
    const frame = frameRef.current;
    if (!frame) return { x: 0, y: 0 };
    const bounds = frame.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * image.width,
      y: ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * image.height,
    };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const rawHandle = target.dataset.handle as Handle | undefined;
    const handle: Handle = rawHandle ?? "move";
    const point = toSource(event);
    dragRef.current = { handle, startX: point.x, startY: point.y, rect: crop };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const point = toSource(event);
    const dx = point.x - drag.startX;
    const dy = point.y - drag.startY;

    if (drag.handle === "move") {
      setCrop(
        clampCrop(
          { ...drag.rect, x: drag.rect.x + dx, y: drag.rect.y + dy },
          image.width,
          image.height,
        ),
      );
      return;
    }

    if (ratio !== null) {
      setCrop(resizeLocked(drag.rect, drag.handle, dx, dy, ratio, image.width, image.height));
    } else {
      setCrop(resizeFree(drag.rect, drag.handle, dx, dy, image.width, image.height));
    }
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const scaleX = displayWidth / image.width;
  const scaleY = displayHeight / image.height;
  const rectStyle: CSSProperties = {
    left: crop.x * scaleX,
    top: crop.y * scaleY,
    width: crop.width * scaleX,
    height: crop.height * scaleY,
  };
  const handles = ratio === null ? FREE_HANDLES : LOCKED_HANDLES;

  return (
    <div className="crop-editor">
      <div className="crop-stage" ref={stageRef}>
        <div
          className="crop-frame"
          ref={frameRef}
          style={{ width: displayWidth, height: displayHeight }}
        >
          <canvas
            ref={canvasRef}
            className="crop-frame__canvas"
            style={{ width: displayWidth, height: displayHeight }}
            aria-hidden="true"
          />
          <div
            className="crop-rect"
            style={rectStyle}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            role="presentation"
          >
            {handles.map((handle) => (
              <span
                key={handle}
                className={`crop-handle crop-handle--${handle}`}
                data-handle={handle}
              />
            ))}
          </div>
        </div>
      </div>
      <p className="crop-editor__hint">
        拖动框内移动，拖动角/边缩放。裁剪区域始终记录为源图像素坐标 （{crop.x}, {crop.y},{" "}
        {crop.width}×{crop.height}）。
      </p>
    </div>
  );
}
