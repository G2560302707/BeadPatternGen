import { useEffect, useRef } from "react";
import { EmptyState } from "../../components/EmptyState";
import { useWorkspaceStore } from "../../state/workspace-store";
import type { SampledGridResult } from "../image-import/sample-bitmap";
import { CropEditor } from "../image-crop/CropEditor";
import { PatternBoard } from "./PatternBoard";

function SampledGridCanvas({ result }: { result: SampledGridResult }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const maxSide = 520;
    const cell = Math.max(1, Math.floor(maxSide / Math.max(result.width, result.height)));
    const width = result.width * cell;
    const height = result.height * cell;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return;

    context.clearRect(0, 0, width, height);
    for (let y = 0; y < result.height; y += 1) {
      for (let x = 0; x < result.width; x += 1) {
        const index = y * result.width + x;
        const alpha = result.alpha[index] ?? 0;
        if (alpha === 0 && result.alphaPolicy === "empty") continue;
        const offset = index * 3;
        const r = result.rgb[offset] ?? 0;
        const g = result.rgb[offset + 1] ?? 0;
        const b = result.rgb[offset + 2] ?? 0;
        context.fillStyle = `rgb(${r}, ${g}, ${b})`;
        context.fillRect(x * cell, y * cell, cell, cell);
      }
    }

    if (cell >= 5) {
      context.strokeStyle = "rgba(44, 33, 24, 0.14)";
      context.lineWidth = 1;
      for (let x = 0; x <= result.width; x += 1) {
        context.beginPath();
        context.moveTo(x * cell + 0.5, 0);
        context.lineTo(x * cell + 0.5, height);
        context.stroke();
      }
      for (let y = 0; y <= result.height; y += 1) {
        context.beginPath();
        context.moveTo(0, y * cell + 0.5);
        context.lineTo(width, y * cell + 0.5);
        context.stroke();
      }
    }
  }, [result]);

  return <canvas ref={canvasRef} className="preview-canvas" aria-label="面积采样只读预览" />;
}

export function PatternPreview() {
  const image = useWorkspaceStore((s) => s.image);
  const crop = useWorkspaceStore((s) => s.crop);
  const sample = useWorkspaceStore((s) => s.sample);
  const draft = useWorkspaceStore((s) => s.draft);
  const pattern = useWorkspaceStore((s) => s.pattern);
  const fitMode = useWorkspaceStore((s) => s.fitMode);
  const generation = useWorkspaceStore((s) => s.generation);
  const clearSample = useWorkspaceStore((s) => s.clearSample);

  if (pattern) {
    return (
      <section
        className="canvas-board canvas-board--pattern"
        aria-label="图纸预览"
        data-testid="pattern-board"
        data-pattern-id={pattern.id}
      >
        <PatternBoard pattern={pattern} />
        {image ? (
          <div className="preview-meta">
            <button type="button" className="btn" onClick={clearSample}>
              返回裁剪 / 重新采样
            </button>
          </div>
        ) : (
          <p className="hint">工程来自 JSON 导入或旧版草稿，原图不在内存中，对照滑块不可用。</p>
        )}
      </section>
    );
  }

  if (!image) {
    return (
      <section className="canvas-board" aria-label="图纸预览">
        <div className="pegboard">
          <EmptyState
            title="钉板是空的"
            body="先导入一张 JPG / PNG / WebP。导入后这里显示裁剪框，应用裁剪后显示采样预览，再生成色卡图纸。"
          />
        </div>
      </section>
    );
  }

  if (!sample || !draft) {
    return (
      <section className="canvas-board" aria-label="裁剪">
        <div className="pegboard pegboard--crop">
          <CropEditor />
        </div>
      </section>
    );
  }

  return (
    <section className="canvas-board" aria-label="采样预览">
      <div className="preview-panel">
        <SampledGridCanvas result={sample} />
        <div className="preview-meta">
          <p>
            图纸草稿 {draft.width}×{draft.height} · 空格 {sample.emptyCount} 格 · 适配 {fitMode}
            {sample.innerGrid
              ? ` · 内网格 ${sample.innerGrid.width}×${sample.innerGrid.height}`
              : ""}
          </p>
          <p>
            source.crop = x {crop?.x ?? 0} · y {crop?.y ?? 0} · {crop?.width ?? 0}×
            {crop?.height ?? 0}（源图像素坐标）
          </p>
          <p className="hint">
            {generation.status === "running"
              ? generation.message
              : "采样完成。点「去调色生成」后才会匹配真实色卡。生成后可用画笔精修。"}
          </p>
          <button type="button" className="btn" onClick={clearSample}>
            返回裁剪 / 重新采样
          </button>
        </div>
      </div>
    </section>
  );
}
