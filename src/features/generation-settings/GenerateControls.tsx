import { getModeProfile } from "../../core/modes";
import type { ColorMetricName, DitheringMode, ImageMode } from "../../core/pattern";
import { LoadingNotice } from "../../components/LoadingNotice";
import { cancelGeneration, startGeneration } from "../../state/generation";
import { useWorkspaceStore } from "../../state/workspace-store";

const MODES: Array<{ id: ImageMode; label: string }> = [
  { id: "photo", label: "照片" },
  { id: "anime", label: "二次元" },
  { id: "logo", label: "图标 / 文字" },
  { id: "landscape", label: "风景" },
];

export function GenerateControls() {
  const sample = useWorkspaceStore((state) => state.sample);
  const mode = useWorkspaceStore((state) => state.mode);
  const maxColors = useWorkspaceStore((state) => state.maxColors);
  const dithering = useWorkspaceStore((state) => state.dithering);
  const colorMetric = useWorkspaceStore((state) => state.colorMetric);
  const generation = useWorkspaceStore((state) => state.generation);
  const setMode = useWorkspaceStore((state) => state.setMode);
  const setMaxColors = useWorkspaceStore((state) => state.setMaxColors);
  const setDithering = useWorkspaceStore((state) => state.setDithering);
  const setColorMetric = useWorkspaceStore((state) => state.setColorMetric);

  if (!sample) return null;

  const profile = getModeProfile(mode);
  const running = generation.status === "running";

  return (
    <section className="control-section">
      <h3>生成图纸</h3>
      <div className="field">
        <label htmlFor="image-mode">模式</label>
        <select
          id="image-mode"
          value={mode}
          disabled={running}
          onChange={(event) => setMode(event.target.value as ImageMode)}
        >
          {MODES.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="max-colors">最大颜色数</label>
        <input
          id="max-colors"
          type="number"
          min={1}
          max={178}
          step={1}
          value={maxColors}
          disabled={running}
          onChange={(event) => setMaxColors(Number(event.target.value))}
        />
      </div>
      <fieldset className="radio-group">
        <legend>抖动</legend>
        <label>
          <input
            type="radio"
            name="dithering"
            checked={dithering === "none"}
            disabled={running}
            onChange={() => setDithering("none")}
          />
          关闭
        </label>
        <label>
          <input
            type="radio"
            name="dithering"
            checked={dithering === "floyd-steinberg"}
            disabled={running || !profile.allowUserDithering}
            onChange={() => setDithering("floyd-steinberg" as DitheringMode)}
          />
          Floyd–Steinberg
        </label>
      </fieldset>
      {!profile.allowUserDithering ? (
        <p className="hint">当前模式强制关闭抖动，避免碎点破坏色块或文字边缘。</p>
      ) : null}
      <fieldset className="radio-group">
        <legend>色差度量</legend>
        <label>
          <input
            type="radio"
            name="metric"
            checked={colorMetric === "ciede2000"}
            disabled={running}
            onChange={() => setColorMetric("ciede2000")}
          />
          CIEDE2000
        </label>
        <label>
          <input
            type="radio"
            name="metric"
            checked={colorMetric === "oklab"}
            disabled={running}
            onChange={() => setColorMetric("oklab" as ColorMetricName)}
          />
          Oklab
        </label>
      </fieldset>
      {running ? (
        <>
          <LoadingNotice label={generation.message || "生成中…"} />
          <button
            type="button"
            className="btn btn--block"
            data-testid="cancel-generate"
            onClick={() => cancelGeneration()}
          >
            取消生成
          </button>
        </>
      ) : (
        <button
          type="button"
          className="btn btn--primary btn--block"
          data-testid="generate"
          onClick={() => startGeneration()}
        >
          生成图纸
        </button>
      )}
      {generation.status === "done" ? (
        <p className="hint">生成完成。可用画笔、橡皮、取色或撤销精修图纸。</p>
      ) : null}
    </section>
  );
}
