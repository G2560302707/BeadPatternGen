import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BeadPattern } from "../../core/pattern";
import { hasOverlayContent } from "../../core/pattern";
import { paintPattern } from "../../render/canvas-renderer";
import {
  CODE_MIN_SCALE,
  MAX_SCALE,
  MIN_SCALE,
  ZOOM_STEP,
  applyPan,
  canShowCodes,
  clampScale,
  fitView,
  identityView,
  zoomAt,
  type ViewTransform,
} from "../../render/view-transform";
import {
  cellAtScreen,
  changesFromMap,
  collectStrokeChange,
  copySelection,
  EMPTY_CELL,
  fillSelection,
  lassoIndices,
  mirrorSelection,
  paintValue,
  pastePatch,
  rectIndices,
  regenSelection,
  replaceColorInSelection,
  rotateSelection,
  translateSelection,
  type PatternEditTool,
} from "../../core/pattern";
import { useWorkspaceStore } from "../../state/workspace-store";
import { usePatternAutosave } from "./use-autosave";
import { deriveRegenSample } from "./regen-sample";

interface PatternBoardProps {
  pattern: BeadPattern;
}

export function PatternBoard({ pattern }: PatternBoardProps) {
  usePatternAutosave();
  const image = useWorkspaceStore((state) => state.image);
  const crop = useWorkspaceStore((state) => state.crop);
  const highlightColorIndex = useWorkspaceStore((state) => state.highlightedColorIndex);
  const highlightList = useWorkspaceStore((state) => state.highlightedCells);
  const editTool = useWorkspaceStore((state) => state.editTool);
  const paintColorIndex = useWorkspaceStore((state) => state.paintColorIndex);
  const undoStack = useWorkspaceStore((state) => state.undoStack);
  const redoStack = useWorkspaceStore((state) => state.redoStack);
  const selection = useWorkspaceStore((state) => state.selection);
  const clipboard = useWorkspaceStore((state) => state.clipboard);
  const sample = useWorkspaceStore((state) => state.sample);
  const fitMode = useWorkspaceStore((state) => state.fitMode);
  const backgroundHex = useWorkspaceStore((state) => state.backgroundHex);
  const baseCells = useWorkspaceStore((state) => state.baseCells);
  const refineVisible = useWorkspaceStore((state) => state.refineVisible);
  const setEditTool = useWorkspaceStore((state) => state.setEditTool);
  const setHighlightedColorIndex = useWorkspaceStore((state) => state.setHighlightedColorIndex);
  const stampPatternCell = useWorkspaceStore((state) => state.stampPatternCell);
  const commitStroke = useWorkspaceStore((state) => state.commitStroke);
  const executeCommand = useWorkspaceStore((state) => state.executeCommand);
  const undoPatternEdit = useWorkspaceStore((state) => state.undoPatternEdit);
  const redoPatternEdit = useWorkspaceStore((state) => state.redoPatternEdit);
  const setPaintColorIndex = useWorkspaceStore((state) => state.setPaintColorIndex);
  const setSelection = useWorkspaceStore((state) => state.setSelection);
  const setClipboard = useWorkspaceStore((state) => state.setClipboard);
  const setRefineVisible = useWorkspaceStore((state) => state.setRefineVisible);
  const restoreRefineLayer = useWorkspaceStore((state) => state.restoreRefineLayer);
  const setError = useWorkspaceStore((state) => state.setError);
  const strokeRef = useRef(false);
  const pendingRef = useRef(new Map<number, { index: number; from: number; to: number }>());
  const selectStartRef = useRef<{ x: number; y: number } | null>(null);
  const lassoRef = useRef<Array<{ x: number; y: number }>>([]);
  const lastMoveIndexRef = useRef<number | null>(null);

  const wrapRef = useRef<HTMLDivElement>(null);
  const patternRef = useRef<HTMLCanvasElement>(null);
  const originalRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<ViewTransform>(identityView());
  const fitKeyRef = useRef<string | null>(null);
  const spaceRef = useRef(false);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  const redrawRef = useRef<() => void>(() => undefined);

  const [showGrid, setShowGrid] = useState(true);
  const [showCoords, setShowCoords] = useState(true);
  const [showCodes, setShowCodes] = useState(false);
  const [compare, setCompare] = useState(50);
  const [scaleLabel, setScaleLabel] = useState(12);
  const [panning, setPanning] = useState(false);

  const codesEnabled = canShowCodes(scaleLabel);

  const hasOverlayDiff = useMemo(
    () => hasOverlayContent(pattern.cells, baseCells ?? pattern.cells),
    [pattern.cells, baseCells],
  );

  useLayoutEffect(() => {
    const highlightCells = highlightList === null ? null : new Set(highlightList);
    const redraw = () => {
      const wrap = wrapRef.current;
      const canvas = patternRef.current;
      const original = originalRef.current;
      if (!wrap || !canvas) return;
      const width = Math.max(1, wrap.clientWidth);
      const height = Math.max(1, wrap.clientHeight);
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      paintPattern(
        ctx,
        pattern,
        viewRef.current,
        { width, height },
        {
          showGrid,
          showCoords,
          showCodes,
          highlightColorIndex,
          highlightCells,
        },
      );
      if (selection && selection.length > 0) {
        ctx.fillStyle = "rgba(0, 152, 195, 0.28)";
        const scale = viewRef.current.scale;
        for (const index of selection) {
          const x = index % pattern.width;
          const y = Math.floor(index / pattern.width);
          ctx.fillRect(
            viewRef.current.offsetX + x * scale,
            viewRef.current.offsetY + y * scale,
            scale,
            scale,
          );
        }
      }

      if (original && image && crop) {
        original.width = width;
        original.height = height;
        const octx = original.getContext("2d");
        if (octx) {
          octx.clearRect(0, 0, width, height);
          octx.fillStyle = "#f4f8fc";
          octx.fillRect(0, 0, width, height);
          octx.imageSmoothingEnabled = false;
          octx.drawImage(
            image.bitmap,
            crop.x,
            crop.y,
            crop.width,
            crop.height,
            viewRef.current.offsetX,
            viewRef.current.offsetY,
            pattern.width * viewRef.current.scale,
            pattern.height * viewRef.current.scale,
          );
        }
      }
      setScaleLabel(viewRef.current.scale);
    };
    redrawRef.current = redraw;
    redraw();
    // compare 只驱动对照层的 CSS clipPath，不需要重绘画布，故不列入依赖。
  }, [
    pattern,
    image,
    crop,
    showGrid,
    showCoords,
    showCodes,
    highlightColorIndex,
    highlightList,
    selection,
  ]);

  // 仅在图纸真正更换（身份 / 尺寸变化）时重新适配视图；编辑只改引用不改 key，
  // 否则画一笔、撤销一次都会把放大后的视图弹回适应窗口。
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const fitKey = `${pattern.id}:${pattern.width}x${pattern.height}`;
    if (fitKeyRef.current !== fitKey) {
      fitKeyRef.current = fitKey;
      viewRef.current = fitView(pattern.width, pattern.height, {
        width: wrap.clientWidth,
        height: wrap.clientHeight,
      });
      redrawRef.current();
    }
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => redrawRef.current());
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [pattern.id, pattern.width, pattern.height]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable
      ) {
        return;
      }
      spaceRef.current = true;
      setPanning(true);
      event.preventDefault();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        spaceRef.current = false;
        setPanning(false);
      }
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = wrap?.getBoundingClientRect();
      if (!wrap || !bounds) return;
      const direction = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      viewRef.current = zoomAt(
        viewRef.current,
        event.clientX - bounds.left,
        event.clientY - bounds.top,
        clampScale(viewRef.current.scale * direction),
      );
      redrawRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    wrap?.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      wrap?.removeEventListener("wheel", onWheel);
    };
  }, []);

  return (
    <div className="pattern-board">
      <div className="pattern-toolbar">
        <button
          type="button"
          className="btn btn--small"
          onClick={() => {
            viewRef.current = zoomAt(
              viewRef.current,
              (wrapRef.current?.clientWidth ?? 0) / 2,
              (wrapRef.current?.clientHeight ?? 0) / 2,
              viewRef.current.scale * ZOOM_STEP,
            );
            redrawRef.current();
          }}
        >
          放大
        </button>
        <button
          type="button"
          className="btn btn--small"
          onClick={() => {
            viewRef.current = zoomAt(
              viewRef.current,
              (wrapRef.current?.clientWidth ?? 0) / 2,
              (wrapRef.current?.clientHeight ?? 0) / 2,
              viewRef.current.scale / ZOOM_STEP,
            );
            redrawRef.current();
          }}
        >
          缩小
        </button>
        <button
          type="button"
          className="btn btn--small"
          onClick={() => {
            const wrap = wrapRef.current;
            if (!wrap) return;
            viewRef.current = fitView(pattern.width, pattern.height, {
              width: wrap.clientWidth,
              height: wrap.clientHeight,
            });
            redrawRef.current();
          }}
        >
          适应窗口
        </button>
        <button
          type="button"
          className="btn btn--small"
          onClick={() => {
            viewRef.current = zoomAt(
              viewRef.current,
              (wrapRef.current?.clientWidth ?? 0) / 2,
              (wrapRef.current?.clientHeight ?? 0) / 2,
              1,
            );
            redrawRef.current();
          }}
        >
          100%
        </button>
        <label>
          <input
            type="checkbox"
            checked={showGrid}
            onChange={(event) => setShowGrid(event.target.checked)}
          />
          网格
        </label>
        <label>
          <input
            type="checkbox"
            checked={showCoords}
            onChange={(event) => setShowCoords(event.target.checked)}
          />
          坐标
        </label>
        <label title={codesEnabled ? "显示色号" : `色号需要放大到 ${CODE_MIN_SCALE} 以上`}>
          <input
            type="checkbox"
            checked={showCodes && codesEnabled}
            disabled={!codesEnabled}
            onChange={(event) => setShowCodes(event.target.checked)}
          />
          色号
        </label>
        <span className="pattern-toolbar__scale">{Math.round(scaleLabel * 10) / 10}×</span>
        {(() => {
          const paintColor = pattern.palette[paintColorIndex];
          return paintColor ? (
            <span
              className="pattern-toolbar__paint"
              title={`当前画笔 / 吸管颜色：${paintColor.code} ${paintColor.name ?? ""}`}
            >
              <span className="pattern-toolbar__paint-swatch" style={{ background: paintColor.hex }} />
              <code>{paintColor.code}</code>
            </span>
          ) : null;
        })()}
        {(
          [
            ["pan", "平移"],
            ["paint", "画笔"],
            ["erase", "橡皮"],
            ["eyedrop", "吸管"],
            ["select-rect", "框选"],
            ["select-lasso", "套索"],
          ] as Array<[PatternEditTool, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={editTool === id ? "btn btn--small btn--primary" : "btn btn--small"}
            data-testid={`edit-tool-${id}`}
            onClick={() => setEditTool(id)}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className="btn btn--small"
          data-testid="edit-undo"
          disabled={undoStack.length === 0}
          onClick={() => undoPatternEdit()}
        >
          撤销
        </button>
        <button
          type="button"
          className="btn btn--small"
          data-testid="edit-redo"
          disabled={redoStack.length === 0}
          onClick={() => redoPatternEdit()}
        >
          重做
        </button>
        <button
          type="button"
          className="btn btn--small"
          data-testid="edit-fill"
          disabled={!selection?.length}
          onClick={() => {
            if (!selection?.length) return;
            executeCommand({
              kind: "fill",
              changes: fillSelection(pattern.cells, selection, paintColorIndex),
            });
          }}
        >
          填充
        </button>
        <button
          type="button"
          className="btn btn--small"
          data-testid="edit-replace"
          disabled={!selection?.length}
          onClick={() => {
            if (!selection?.length) return;
            const from = pattern.cells[selection[0] ?? 0];
            if (from === undefined) return;
            executeCommand({
              kind: "replace",
              changes: replaceColorInSelection(pattern.cells, selection, from, paintColorIndex),
            });
          }}
        >
          替换色
        </button>
        <button
          type="button"
          className="btn btn--small"
          disabled={!selection?.length}
          onClick={() => {
            if (!selection?.length) return;
            executeCommand({
              kind: "mirror",
              changes: mirrorSelection(pattern.cells, selection, pattern.width, "h"),
            });
          }}
        >
          水平镜像
        </button>
        <button
          type="button"
          className="btn btn--small"
          disabled={!selection?.length}
          onClick={() => {
            if (!selection?.length) return;
            executeCommand({
              kind: "mirror",
              changes: mirrorSelection(pattern.cells, selection, pattern.width, "v"),
            });
          }}
        >
          垂直镜像
        </button>
        <button
          type="button"
          className="btn btn--small"
          disabled={!selection?.length}
          onClick={() => {
            if (!selection?.length) return;
            const result = rotateSelection(
              pattern.cells,
              selection,
              pattern.width,
              pattern.height,
              1,
            );
            executeCommand({ kind: "rotate", changes: result.changes });
            setSelection(result.selection);
          }}
        >
          旋转
        </button>
        {(
          [
            ["up", "上移", 0, -1],
            ["down", "下移", 0, 1],
            ["left", "左移", -1, 0],
            ["right", "右移", 1, 0],
          ] as Array<[string, string, number, number]>
        ).map(([id, label, dx, dy]) => (
          <button
            key={id}
            type="button"
            className="btn btn--small"
            data-testid={`edit-move-${id}`}
            disabled={!selection?.length}
            onClick={() => {
              if (!selection?.length) return;
              const result = translateSelection(
                pattern.cells,
                selection,
                pattern.width,
                pattern.height,
                dx,
                dy,
              );
              executeCommand({ kind: "translate", changes: result.changes });
              setSelection(result.selection);
            }}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className="btn btn--small"
          disabled={!selection?.length}
          onClick={() => {
            if (!selection?.length) return;
            setClipboard(copySelection(pattern.cells, selection, pattern.width));
          }}
        >
          复制
        </button>
        <button
          type="button"
          className="btn btn--small"
          disabled={!clipboard}
          onClick={() => {
            if (!clipboard) return;
            const destX = selection?.length
              ? (selection[0] ?? 0) % pattern.width
              : clipboard.originX;
            const destY = selection?.length
              ? Math.floor((selection[0] ?? 0) / pattern.width)
              : clipboard.originY;
            executeCommand({
              kind: "paste",
              changes: pastePatch(
                pattern.cells,
                pattern.width,
                pattern.height,
                clipboard,
                destX,
                destY,
              ),
            });
          }}
        >
          粘贴
        </button>
        <button
          type="button"
          className="btn btn--small"
          data-testid="edit-regen"
          title={
            !sample && !image
              ? "需要原图才能局部再生成：打开的项目没有采样缓冲，也没有可重采样的原图。"
              : undefined
          }
          disabled={!selection?.length || (!sample && !image)}
          onClick={() => {
            if (!selection?.length) return;
            const locked =
              useWorkspaceStore.getState().lockedCells ??
              new Uint8Array(pattern.cells.length);
            let buffer = sample;
            if (!buffer && image) {
              try {
                buffer = deriveRegenSample({
                  pattern,
                  bitmap: image.bitmap,
                  crop,
                  fitMode,
                  backgroundHex,
                });
              } catch {
                buffer = null;
              }
            }
            if (!buffer) {
              setError({
                code: "E_REGEN_NO_SOURCE",
                message: "需要原图才能局部再生成：当前既没有采样缓冲，也无法从原图重采样。",
              });
              return;
            }
            executeCommand({
              kind: "regen",
              changes: regenSelection({
                cells: pattern.cells,
                locked,
                indices: selection,
                width: pattern.width,
                height: pattern.height,
                rgb: buffer.rgb,
                alpha: buffer.alpha,
                palette: pattern.palette,
                metric: pattern.settings.colorMetric,
                transparentPolicy: pattern.settings.transparentPolicy,
              }),
            });
          }}
        >
          选区再生成
        </button>
        <label title="精修层显示 / 隐藏：隐藏后画布、统计与导出都使用生成基底">
          <input
            type="checkbox"
            data-testid="refine-visible"
            checked={refineVisible}
            onChange={(event) => setRefineVisible(event.target.checked)}
          />
          精修层
        </label>
        <button
          type="button"
          className="btn btn--small"
          data-testid="restore-refine"
          disabled={!hasOverlayDiff}
          title={
            hasOverlayDiff
              ? "清空精修层，图纸回到生成基底（可撤销）"
              : "精修层当前没有相对基底的改动"
          }
          onClick={() => restoreRefineLayer()}
        >
          从基底还原精修层
        </button>
      </div>
      {!codesEnabled ? (
        <p className="hint">色号开关已禁用：当前缩放低于 {CODE_MIN_SCALE}，字会糊成一片。</p>
      ) : null}
      <p className="hint">
        滚轮缩放。空格或平移拖动画布。画笔/橡皮按格改色；框选后可填充、镜像、复制、平移；已改过的格子会锁定，选区再生成不会覆盖。没有采样缓冲时，选区再生成会用内存中的原图重新采样；连原图都没有则该按钮禁用。
      </p>
      <div
        ref={wrapRef}
        className={`pattern-stage${panning || editTool === "pan" ? " pattern-stage--pan" : ""}`}
        onPointerDown={(event) => {
          const pan = spaceRef.current || editTool === "pan";
          if (pan) {
            dragRef.current = { x: event.clientX, y: event.clientY };
            event.currentTarget.setPointerCapture(event.pointerId);
            return;
          }
          const wrap = wrapRef.current;
          if (!wrap) return;
          const box = wrap.getBoundingClientRect();
          const hit = cellAtScreen(
            event.clientX - box.left,
            event.clientY - box.top,
            viewRef.current.offsetX,
            viewRef.current.offsetY,
            viewRef.current.scale,
            pattern.width,
            pattern.height,
          );
          if (!hit) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          lastMoveIndexRef.current = hit.index;
          if (editTool === "eyedrop") {
            const current = pattern.cells[hit.index] ?? EMPTY_CELL;
            if (current !== EMPTY_CELL) {
              setPaintColorIndex(current);
              // 吸色同时高亮同色格子：立刻能看到吸到了什么、用在了哪里。
              setHighlightedColorIndex(current);
            }
            return;
          }
          if (editTool === "select-rect") {
            selectStartRef.current = { x: hit.x, y: hit.y };
            setSelection([hit.index]);
            return;
          }
          if (editTool === "select-lasso") {
            lassoRef.current = [{ x: hit.x + 0.5, y: hit.y + 0.5 }];
            setSelection([hit.index]);
            strokeRef.current = true;
            return;
          }
          const value = paintValue(editTool, paintColorIndex);
          if (value === null) return;
          strokeRef.current = true;
          pendingRef.current = new Map();
          const change = collectStrokeChange(pattern.cells, hit.index, value, pendingRef.current);
          if (change) stampPatternCell(hit.index, value);
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (drag) {
            viewRef.current = applyPan(
              viewRef.current,
              event.clientX - drag.x,
              event.clientY - drag.y,
            );
            dragRef.current = { x: event.clientX, y: event.clientY };
            redrawRef.current();
            return;
          }
          const wrap = wrapRef.current;
          if (!wrap) return;
          const box = wrap.getBoundingClientRect();
          const hit = cellAtScreen(
            event.clientX - box.left,
            event.clientY - box.top,
            viewRef.current.offsetX,
            viewRef.current.offsetY,
            viewRef.current.scale,
            pattern.width,
            pattern.height,
          );
          if (!hit) return;
          // 指针还在同一格内：框选/套索/笔迹都没有新状态，跳过整段重绘。
          if (lastMoveIndexRef.current === hit.index) return;
          lastMoveIndexRef.current = hit.index;
          if (editTool === "select-rect" && selectStartRef.current) {
            setSelection(
              rectIndices(
                selectStartRef.current.x,
                selectStartRef.current.y,
                hit.x,
                hit.y,
                pattern.width,
                pattern.height,
              ),
            );
            return;
          }
          if (editTool === "select-lasso" && strokeRef.current) {
            lassoRef.current.push({ x: hit.x + 0.5, y: hit.y + 0.5 });
            setSelection(lassoIndices(lassoRef.current, pattern.width, pattern.height));
            return;
          }
          if (!strokeRef.current) return;
          const value = paintValue(editTool, paintColorIndex);
          if (value === null) return;
          const live = useWorkspaceStore.getState().pattern;
          if (!live) return;
          const change = collectStrokeChange(live.cells, hit.index, value, pendingRef.current);
          if (change) stampPatternCell(hit.index, value);
        }}
        onPointerUp={() => {
          dragRef.current = null;
          lastMoveIndexRef.current = null;
          if (editTool === "select-rect") selectStartRef.current = null;
          if (editTool === "select-lasso") {
            strokeRef.current = false;
            lassoRef.current = [];
          }
          if (strokeRef.current && (editTool === "paint" || editTool === "erase")) {
            commitStroke(editTool, changesFromMap(pendingRef.current));
            pendingRef.current = new Map();
          }
          strokeRef.current = false;
        }}
      >
        <canvas ref={patternRef} className="pattern-stage__canvas" aria-label="拼豆图纸预览" />
        <canvas
          ref={originalRef}
          className="pattern-stage__original"
          style={{ clipPath: `inset(0 ${100 - compare}% 0 0)` }}
          aria-hidden="true"
        />
      </div>
      <label className="compare-slider">
        原图 / 结果对照
        <input
          type="range"
          min={0}
          max={100}
          value={compare}
          onChange={(event) => setCompare(Number(event.target.value))}
        />
        <span>{compare}% 原图</span>
      </label>
      <p className="hint">
        视口缩放范围 {MIN_SCALE}–{MAX_SCALE}。图纸 {pattern.width}×{pattern.height}。
      </p>
    </div>
  );
}
