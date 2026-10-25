import { getModeProfile } from "../../core/modes";
import type { ColorMetricName, DitheringMode, ImageMode } from "../../core/pattern";
import { LoadingNotice } from "../../components/LoadingNotice";
import { PIPELINE_STAGE_LABELS, progressPercent } from "../../core/pipeline";
import { paletteDefinition } from "../palette-panel/locked-palette";
import { cancelGeneration, startGeneration } from "../../state/generation";
import { useWorkspaceStore } from "../../state/workspace-store";

const MODES: Array<{ id: ImageMode; label: string; emoji: string; desc: string }> = [
  { id: "photo", label: "照片", emoji: "📸", desc: "人物宠物实拍，保护五官与层次" },
  { id: "anime", label: "二次元", emoji: "🌸", desc: "插画动漫，保护描边和高光" },
  { id: "logo", label: "图标文字", emoji: "🔤", desc: "图标字母，硬边不糊，透明留空" },
  { id: "landscape", label: "风景", emoji: "🏞️", desc: "天空水面，渐变干净无杂点" },
];

export function GenerateControls() {
  const sample = useWorkspaceStore((state) => state.sample);
  const mode = useWorkspaceStore((state) => state.mode);
  const maxColors = useWorkspaceStore((state) => state.maxColors);
  const dithering = useWorkspaceStore((state) => state.dithering);
  const colorMetric = useWorkspaceStore((state) => state.colorMetric);
  const outlineStrength = useWorkspaceStore((state) => state.outlineStrength);
  const generation = useWorkspaceStore((state) => state.generation);
  const setMode = useWorkspaceStore((state) => state.setMode);
  const setMaxColors = useWorkspaceStore((state) => state.setMaxColors);
  const setDithering = useWorkspaceStore((state) => state.setDithering);
  const setColorMetric = useWorkspaceStore((state) => state.setColorMetric);
  const setOutlineStrength = useWorkspaceStore((state) => state.setOutlineStrength);
  const paletteId = useWorkspaceStore((state) => state.paletteId);

  if (!sample) return null;

  const profile = getModeProfile(mode);
  const running = generation.status === "running";
  const paletteSize = paletteDefinition(paletteId).colors.length;
  const percent =
    generation.status === "running" && generation.stage
      ? progressPercent(generation.done, generation.total)
      : null;
  // S11.1 · 描边强度：仅描边模式展示；null = 跟随模式默认。
  const outlinePolicy = profile.outline ?? null;
  const rimEnabled = outlinePolicy !== null && outlinePolicy.rim;
  const effectiveOutline = outlineStrength ?? outlinePolicy?.rimStrength ?? 0;

  return (
    <section className="control-section">
      <h3>画风与颜色</h3>
      <div className="mode-cards" role="radiogroup" aria-label="画风模式">
        {MODES.map((item) => (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={mode === item.id}
            className={`mode-card${mode === item.id ? " mode-card--active" : ""}`}
            disabled={running}
            onClick={() => setMode(item.id)}
          >
            <span className="mode-card__emoji" aria-hidden="true">
              {item.emoji}
            </span>
            <span className="mode-card__name">{item.label}</span>
            <span className="mode-card__desc">{item.desc}</span>
          </button>
        ))}
      </div>

      <div className="field">
        <label htmlFor="max-colors">
          最大颜色数（1 – {paletteSize}）：颜色越少越省豆，画面越简化
        </label>
        <input
          id="max-colors"
          type="number"
          min={1}
          max={paletteSize}
          step={1}
          value={maxColors}
          disabled={running}
          onChange={(event) => setMaxColors(Number(event.target.value))}
        />
      </div>

      {rimEnabled ? (
        <div className="field">
          <label htmlFor="outline-strength">
            描边强度（{Math.round(effectiveOutline * 100)}%）
            {outlineStrength === null ? "：跟随模式默认" : ""}
          </label>
          <input
            id="outline-strength"
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(effectiveOutline * 100)}
            disabled={running}
            onChange={(event) => setOutlineStrength(Number(event.target.value) / 100)}
          />
          <p className="hint">
            主体轮廓加一圈随色调变化的深色边，深色段自动留白不打双线。拉到 0% 可关闭描边。
            {outlineStrength !== null ? (
              <>
                {" "}
                <button
                  type="button"
                  className="link-button"
                  disabled={running}
                  onClick={() => setOutlineStrength(null)}
                >
                  恢复默认
                </button>
              </>
            ) : null}
          </p>
        </div>
      ) : null}

      <details className="adv">
        <summary>高级选项：抖动 · 色差度量</summary>
        <fieldset className="radio-group">
          <legend>抖动（渐变更柔，色块图建议关）</legend>
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
            CIEDE2000（推荐，感知最准）
          </label>
          <label>
            <input
              type="radio"
              name="metric"
              checked={colorMetric === "oklab"}
              disabled={running}
              onChange={() => setColorMetric("oklab" as ColorMetricName)}
            />
            Oklab（高饱和图有时更好）
          </label>
        </fieldset>
      </details>

      {running ? (
        <>
          <div
            className="progress-track"
            role="progressbar"
            aria-valuenow={percent ?? undefined}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="progress-track__fill"
              style={{ width: `${percent ?? 0}%` }}
            />
          </div>
          <LoadingNotice
            label={`${generation.stage ? PIPELINE_STAGE_LABELS[generation.stage] : ""} ${generation.message || "生成中…"}`}
          />
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
          {generation.status === "done" ? "重新生成图纸" : "✨ 生成图纸"}
        </button>
      )}
      {generation.status === "done" ? (
        <p className="hint">生成完成，正在带你去精修画布…</p>
      ) : null}
    </section>
  );
}
