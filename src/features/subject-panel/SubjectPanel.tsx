import { useState } from "react";
import { ErrorNotice } from "../../components/ErrorNotice";
import { LoadingNotice } from "../../components/LoadingNotice";
import { detectSubjects } from "../subject-detect";
import { persistSubjectMaskInBrowser } from "../../workers/subject-service";
import { useWorkspaceStore } from "../../state/workspace-store";
import {
  BRUSH_RADIUS_PRESETS,
  MAX_UNDO,
  clampBrushRadius,
  commitMaskEdit,
  type BrushMode,
} from "./brush";
import { MaskCanvas } from "./MaskCanvas";

export function SubjectPanel() {
  const image = useWorkspaceStore((state) => state.image);
  const progress = useWorkspaceStore((state) => state.subjectProgress);
  const error = useWorkspaceStore((state) => state.subjectError);
  const candidates = useWorkspaceStore((state) => state.subjectCandidates);
  const selectedId = useWorkspaceStore((state) => state.selectedSubjectId);
  const manualBoxHint = useWorkspaceStore((state) => state.manualBoxHint);
  const selectSubject = useWorkspaceStore((state) => state.selectSubject);
  const setManualBoxHint = useWorkspaceStore((state) => state.setManualBoxHint);
  const resetSubject = useWorkspaceStore((state) => state.resetSubject);
  const patchSelectedCandidate = useWorkspaceStore((state) => state.patchSelectedCandidate);
  const ensurePaintCandidate = useWorkspaceStore((state) => state.ensurePaintCandidate);

  const selected = candidates.find((item) => item.id === selectedId) ?? candidates[0] ?? null;
  const running = progress.status === "running";
  const noSubject = error?.code === "E_NO_SUBJECT";
  const failed = Boolean(error);
  const [mode, setMode] = useState<BrushMode>("add");
  const [radius, setRadius] = useState(8);
  const [undoStack, setUndoStack] = useState<ReturnType<typeof commitMaskEdit>[]>([]);

  const brushEnabled = Boolean(image) && !running && Boolean(selected);
  const canUndo = selected ? undoStack.some((item) => item.id === selected.id) : false;

  const pushUndo = (previous: NonNullable<typeof selected>) => {
    setUndoStack((stack) => [...stack.slice(1 - MAX_UNDO), previous]);
  };

  const startBrush = (nextMode: BrushMode) => {
    setMode(nextMode);
    setManualBoxHint(true);
    ensurePaintCandidate();
  };

  const undo = () => {
    if (!selected) return;
    let index = -1;
    for (let i = undoStack.length - 1; i >= 0; i -= 1) {
      if (undoStack[i]?.id === selected.id) {
        index = i;
        break;
      }
    }
    if (index < 0) return;
    const previous = undoStack[index];
    if (!previous) return;
    setUndoStack((stack) => stack.filter((_, i) => i !== index));
    patchSelectedCandidate(previous);
    void persistSubjectMaskInBrowser(previous);
  };

  return (
    <section className="control-section" data-testid="subject-panel">
      <h3>主体选择</h3>
      {image ? (
        <MaskCanvas
          image={image}
          candidate={selected}
          mode={mode}
          radius={radius}
          enabled={brushEnabled}
          onStrokeEnd={(previous, data) => {
            pushUndo(previous);
            const next = commitMaskEdit(previous, data);
            patchSelectedCandidate(next);
            void persistSubjectMaskInBrowser(next);
          }}
        />
      ) : (
        <p className="hint">导入图片后开始识别。</p>
      )}

      {running ? (
        <div data-testid="subject-progress">
          <LoadingNotice label={progress.message || "识别中…"} />
        </div>
      ) : null}

      {error ? (
        <div data-testid="subject-error" data-code={error.code}>
          <ErrorNotice code={error.code} message={error.message} onDismiss={resetSubject} />
        </div>
      ) : null}

      {candidates.length > 1 ? (
        <p className="inline-warning" role="status" data-testid="subject-multi-hint">
          检测到多个候选，请选择一个继续构图。
        </p>
      ) : null}

      {candidates.length > 0 ? (
        <ul className="candidate-list">
          {candidates.map((item, index) => (
            <li key={item.id}>
              <button
                type="button"
                className={item.id === selected?.id ? "btn btn--small usage-row--active" : "btn btn--small"}
                data-testid={`subject-candidate-${item.id}`}
                onClick={() => selectSubject(item.id)}
              >
                候选 {index + 1} · 置信度 {(item.confidence * 100).toFixed(0)}%
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <section className="brush-tools" data-testid="mask-brush">
        <h4>蒙版画笔</h4>
        <div className="compose-actions">
          <button
            type="button"
            className={mode === "add" ? "btn btn--small btn--primary" : "btn btn--small"}
            data-testid="brush-add"
            disabled={!image || running}
            onClick={() => startBrush("add")}
          >
            补选
          </button>
          <button
            type="button"
            className={mode === "erase" ? "btn btn--small btn--primary" : "btn btn--small"}
            data-testid="brush-erase"
            disabled={!image || running}
            onClick={() => startBrush("erase")}
          >
            擦除
          </button>
          <button
            type="button"
            className="btn btn--small"
            data-testid="brush-undo"
            disabled={!canUndo || running}
            onClick={undo}
          >
            撤销
          </button>
        </div>
        <div className="field">
          <label htmlFor="brush-radius">笔刷 {radius}px</label>
          <input
            id="brush-radius"
            type="range"
            min={1}
            max={64}
            step={1}
            data-testid="brush-radius"
            value={radius}
            disabled={!image || running}
            onChange={(event) => setRadius(clampBrushRadius(Number(event.target.value)))}
          />
        </div>
        <div className="preset-row">
          {BRUSH_RADIUS_PRESETS.map((value) => (
            <button
              key={value}
              type="button"
              className={radius === value ? "btn btn--small btn--primary" : "btn btn--small"}
              disabled={!image || running}
              onClick={() => setRadius(value)}
            >
              {value}
            </button>
          ))}
        </div>
      </section>

      <div className="compose-actions">
        <button
          type="button"
          className="btn btn--small"
          data-testid="redetect-subject"
          disabled={!image || running}
          onClick={() => detectSubjects()}
        >
          重新识别
        </button>
        <button
          type="button"
          className={mode === "box" ? "btn btn--small btn--primary" : "btn btn--small"}
          data-testid="subject-manual-box"
          disabled={!image || running}
          onClick={() => {
            setMode("box");
            setManualBoxHint(true);
            ensurePaintCandidate();
          }}
        >
          手动框选
        </button>
      </div>
      {manualBoxHint || noSubject || failed ? (
        <p className="hint" data-testid="subject-manual-placeholder">
          {noSubject || failed
            ? "识别没有给出可用主体。可在原图上拖框，或用补选涂出主体，或跳过构图按整图生成。"
            : mode === "box"
              ? "在原图上拖出一个矩形，矩形内会写成主体蒙版。"
              : "蒙版有缺口时用补选填上，多选到背景时用擦除。"}
        </p>
      ) : (
        <p className="hint">简单笔刷即可，不是专业蒙版编辑器。修改后会按契约重算边界框。</p>
      )}
    </section>
  );
}
