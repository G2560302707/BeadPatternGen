import { MAX_GRID_HEIGHT, MAX_GRID_WIDTH } from "../../core/pattern";
import { useWorkspaceStore } from "../../state/workspace-store";
import { BackgroundSelector } from "./BackgroundSelector";
import { OverflowNotice } from "./OverflowNotice";
import {
  SCALE_PRESETS,
  canvasSizeForAspect,
  clampScale,
  offsetsForPosition,
  type AspectPreset,
  type PositionPreset,
} from "./layout";

const ASPECTS: Array<{ id: AspectPreset; label: string }> = [
  { id: "square", label: "正方形" },
  { id: "portrait", label: "竖版" },
  { id: "landscape", label: "横版" },
];

const POSITIONS: Array<{ id: PositionPreset; label: string }> = [
  { id: "center", label: "居中" },
  { id: "up", label: "偏上" },
  { id: "down", label: "偏下" },
  { id: "left", label: "偏左" },
  { id: "right", label: "偏右" },
  { id: "free", label: "自由" },
];

export function CompositionParamsPanel() {
  const params = useWorkspaceStore((state) => state.compositionParams);
  const aspect = useWorkspaceStore((state) => state.compositionAspect);
  const position = useWorkspaceStore((state) => state.compositionPosition);
  const patchCompositionParams = useWorkspaceStore((state) => state.patchCompositionParams);
  const setCompositionAspect = useWorkspaceStore((state) => state.setCompositionAspect);
  const setCompositionPosition = useWorkspaceStore((state) => state.setCompositionPosition);
  const locked = params.subjectLocked;
  const gridW = useWorkspaceStore((state) => state.gridW);
  const gridH = useWorkspaceStore((state) => state.gridH);
  const setGridSize = useWorkspaceStore((state) => state.setGridSize);

  return (
    <aside className="panel panel--right" data-testid="composition-params">
      <header className="panel__head">
        <h2>构图参数</h2>
      </header>

      <OverflowNotice />

      <section className="control-section">
        <h3>主体锁定</h3>
        <label className="radio-group">
          <input
            type="checkbox"
            data-testid="subject-lock"
            checked={locked}
            onChange={(event) => patchCompositionParams({ subjectLocked: event.target.checked })}
          />
          锁定主体（改背景不改变大小 / 位置）
        </label>
      </section>

      <BackgroundSelector />

      <section className="control-section">
        <h3>主体占比</h3>
        <div className="preset-row">
          {SCALE_PRESETS.map((value) => (
            <button
              key={value}
              type="button"
              className={
                params.subjectScale === value ? "btn btn--small btn--primary" : "btn btn--small"
              }
              data-testid={`compose-scale-${Math.round(value * 100)}`}
              disabled={locked}
              onClick={() => patchCompositionParams({ subjectScale: value })}
            >
              {Math.round(value * 100)}%
            </button>
          ))}
        </div>
        <div className="field">
          <label htmlFor="subject-scale">自定义（50–90）</label>
          <input
            id="subject-scale"
            type="number"
            min={50}
            max={90}
            step={1}
            disabled={locked}
            value={Math.round(params.subjectScale * 100)}
            onChange={(event) =>
              patchCompositionParams({ subjectScale: clampScale(Number(event.target.value) / 100) })
            }
          />
        </div>
      </section>

      <section className="control-section">
        <h3>主体位置</h3>
        <div className="preset-row">
          {POSITIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={position === item.id ? "btn btn--small btn--primary" : "btn btn--small"}
              data-testid={`compose-pos-${item.id}`}
              disabled={locked}
              onClick={() => {
                setCompositionPosition(item.id);
                const next = offsetsForPosition(item.id);
                if (next) patchCompositionParams(next);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      <section className="control-section">
        <h3>画布比例</h3>
        <div className="preset-row">
          {ASPECTS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={aspect === item.id ? "btn btn--small btn--primary" : "btn btn--small"}
              onClick={() => {
                const size = canvasSizeForAspect(item.id, 1024);
                setCompositionAspect(item.id);
                patchCompositionParams({ canvasWidth: size.width, canvasHeight: size.height });
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="hint">
          {params.canvasWidth}×{params.canvasHeight}px
        </p>
      </section>

      <section className="control-section">
        <h3>图纸网格</h3>
        <div className="field-grid">
          <div className="field">
            <label htmlFor="compose-grid-w">宽（颗）</label>
            <input
              id="compose-grid-w"
              type="number"
              min={1}
              max={MAX_GRID_WIDTH}
              value={gridW}
              onChange={(event) => setGridSize(Number(event.target.value), gridH)}
            />
          </div>
          <div className="field">
            <label htmlFor="compose-grid-h">高（颗）</label>
            <input
              id="compose-grid-h"
              type="number"
              min={1}
              max={MAX_GRID_HEIGHT}
              value={gridH}
              onChange={(event) => setGridSize(gridW, Number(event.target.value))}
            />
          </div>
        </div>
      </section>

      <section className="control-section">
        <h3>边距</h3>
        <label className="radio-group">
          <input
            type="checkbox"
            checked={params.margin > 0}
            onChange={(event) =>
              patchCompositionParams({ margin: event.target.checked ? 0.05 : 0 })
            }
          />
          保留 5% 边距
        </label>
      </section>
    </aside>
  );
}
