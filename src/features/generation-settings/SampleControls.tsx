import { useState } from "react";
import { LoadingNotice } from "../../components/LoadingNotice";
import { MAX_GRID_HEIGHT, MAX_GRID_WIDTH, createDraftPattern } from "../../core/pattern";
import type { GenerationSettings } from "../../core/pattern";
import { SamplingError } from "../../core/sampling";
import { lockedPalette, lockedPaletteColors } from "../palette-panel/locked-palette";
import { useWorkspaceStore } from "../../state/workspace-store";
import { sampleBitmapToGrid } from "../image-import/sample-bitmap";

export function SampleControls() {
  const image = useWorkspaceStore((state) => state.image);
  const crop = useWorkspaceStore((state) => state.crop);
  const gridW = useWorkspaceStore((state) => state.gridW);
  const gridH = useWorkspaceStore((state) => state.gridH);
  const fitMode = useWorkspaceStore((state) => state.fitMode);
  const alphaPolicy = useWorkspaceStore((state) => state.alphaPolicy);
  const backgroundHex = useWorkspaceStore((state) => state.backgroundHex);
  const setGridSize = useWorkspaceStore((state) => state.setGridSize);
  const setAlphaPolicy = useWorkspaceStore((state) => state.setAlphaPolicy);
  const setBackgroundHex = useWorkspaceStore((state) => state.setBackgroundHex);
  const mode = useWorkspaceStore((state) => state.mode);
  const maxColors = useWorkspaceStore((state) => state.maxColors);
  const dithering = useWorkspaceStore((state) => state.dithering);
  const colorMetric = useWorkspaceStore((state) => state.colorMetric);
  const applySample = useWorkspaceStore((state) => state.applySample);
  const setError = useWorkspaceStore((state) => state.setError);

  const [busy, setBusy] = useState(false);

  const apply = async () => {
    if (!image || !crop || busy) return;
    setBusy(true);
    // 让“采样中”先渲染一帧，再执行同步采样（Worker 在 S10 接入）。
    await new Promise((resolve) => setTimeout(resolve, 0));
    // 等待期间用户可能更换/移除图片；旧位图已 close，不能再画。
    if (useWorkspaceStore.getState().image !== image) {
      setBusy(false);
      return;
    }
    try {
      const sampled = sampleBitmapToGrid({
        bitmap: image.bitmap,
        crop,
        gridW,
        gridH,
        fitMode,
        alphaPolicy,
        backgroundHex,
      });

      const settings: GenerationSettings = {
        maxColors,
        dithering,
        colorMetric,
        transparentPolicy: alphaPolicy,
      };
      if (alphaPolicy === "background") {
        settings.backgroundHex = backgroundHex;
      }

      const draft = createDraftPattern({
        id:
          typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `draft-${Date.now()}`,
        title: image.fileName,
        width: gridW,
        height: gridH,
        palette: lockedPaletteColors(),
        mode,
        paletteId: lockedPalette.paletteId,
        paletteVersion: lockedPalette.version,
        settings,
        source: {
          originalWidth: image.width,
          originalHeight: image.height,
          aspectRatio: image.width / image.height,
          crop: { x: crop.x, y: crop.y, width: crop.width, height: crop.height },
        },
      });

      applySample(sampled, draft);
    } catch (error) {
      setError({
        code: error instanceof SamplingError ? error.code : "E_SAMPLE_FAILED",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="control-section">
      <h3>图纸与透明</h3>

      <div className="field-grid">
        <div className="field">
          <label htmlFor="grid-w">宽（颗）</label>
          <input
            id="grid-w"
            type="number"
            min={1}
            max={MAX_GRID_WIDTH}
            step={1}
            value={gridW}
            onChange={(event) => setGridSize(Number(event.target.value), gridH)}
          />
        </div>
        <div className="field">
          <label htmlFor="grid-h">高（颗）</label>
          <input
            id="grid-h"
            type="number"
            min={1}
            max={MAX_GRID_HEIGHT}
            step={1}
            value={gridH}
            onChange={(event) => setGridSize(gridW, Number(event.target.value))}
          />
        </div>
      </div>
      <p className="hint">网格上限 256×256。当前比例 {(gridW / gridH).toFixed(3)}。</p>

      <fieldset className="radio-group">
        <legend>透明策略</legend>
        <label>
          <input
            type="radio"
            name="alpha-policy"
            checked={alphaPolicy === "empty"}
            onChange={() => setAlphaPolicy("empty")}
          />
          空格（透明处不拼豆，默认）
        </label>
        <label>
          <input
            type="radio"
            name="alpha-policy"
            checked={alphaPolicy === "background"}
            onChange={() => setAlphaPolicy("background")}
          />
          背景色（透明处拼成指定颜色）
        </label>
      </fieldset>

      {alphaPolicy === "background" ? (
        <div className="field field--inline">
          <label htmlFor="background-hex">背景色</label>
          <input
            id="background-hex"
            type="color"
            value={backgroundHex}
            onChange={(event) => setBackgroundHex(event.target.value.toUpperCase())}
          />
          <code>{backgroundHex}</code>
        </div>
      ) : null}

      <button
        type="button"
        className="btn btn--primary btn--block"
        data-testid="apply-sample"
        disabled={!image || !crop || busy}
        onClick={() => {
          void apply();
        }}
      >
        {busy ? "采样中…" : "应用裁剪并采样"}
      </button>
      {busy ? <LoadingNotice label="正在按面积采样…" /> : null}
      <p className="hint">先采样，再在下方生成图纸。生成后可在画布上精修单格。</p>
    </section>
  );
}
