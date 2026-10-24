import { useWorkspaceStore } from "../../state/workspace-store";
import { clampCrop, computeAutoCrop, fitRectToAspect } from "./crop-math";
import type { CropAspectMode, CropRect } from "./crop-math";

const LOCKED_RATIOS: ReadonlyArray<readonly [string, number]> = [
  ["1:1", 1],
  ["4:3", 4 / 3],
  ["3:4", 3 / 4],
  ["16:9", 16 / 9],
  ["9:16", 9 / 16],
];

function ratioValue(
  mode: CropAspectMode,
  lockedRatio: number,
  gridW: number,
  gridH: number,
): number | null {
  if (mode === "free") return null;
  return mode === "locked" ? lockedRatio : gridW / gridH;
}

export function CropControls() {
  const image = useWorkspaceStore((state) => state.image);
  const crop = useWorkspaceStore((state) => state.crop);
  const aspectMode = useWorkspaceStore((state) => state.aspectMode);
  const lockedRatio = useWorkspaceStore((state) => state.lockedRatio);
  const fitMode = useWorkspaceStore((state) => state.fitMode);
  const gridW = useWorkspaceStore((state) => state.gridW);
  const gridH = useWorkspaceStore((state) => state.gridH);
  const setCrop = useWorkspaceStore((state) => state.setCrop);
  const setAspectMode = useWorkspaceStore((state) => state.setAspectMode);
  const setLockedRatio = useWorkspaceStore((state) => state.setLockedRatio);
  const setFitMode = useWorkspaceStore((state) => state.setFitMode);

  if (!image || !crop) return null;

  const ratio = ratioValue(aspectMode, lockedRatio, gridW, gridH);

  const updateField = (field: keyof CropRect, raw: string) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    const clamped = clampCrop({ ...crop, [field]: value }, image.width, image.height);
    // 锁定比例时，宽高输入必须继续满足比例；x/y 只平移，不改变比例。
    if (ratio !== null && (field === "width" || field === "height")) {
      setCrop(fitRectToAspect(clamped, ratio, image.width, image.height));
      return;
    }
    setCrop(clamped);
  };

  const selectAspectMode = (mode: CropAspectMode) => {
    setAspectMode(mode);
    const nextRatio = ratioValue(mode, lockedRatio, gridW, gridH);
    if (nextRatio !== null) {
      setCrop(fitRectToAspect(crop, nextRatio, image.width, image.height));
    }
  };

  const selectLockedRatio = (value: number) => {
    setLockedRatio(value);
    if (aspectMode === "locked") {
      setCrop(fitRectToAspect(crop, value, image.width, image.height));
    }
  };

  return (
    <section className="control-section" data-testid="crop-controls">
      <h3>裁剪</h3>

      <div className="field">
        <label htmlFor="crop-aspect">比例模式</label>
        <select
          id="crop-aspect"
          value={aspectMode}
          onChange={(event) => selectAspectMode(event.target.value as CropAspectMode)}
        >
          <option value="free">自由裁剪</option>
          <option value="locked">锁定比例</option>
          <option value="pattern">
            图纸比例（{gridW}:{gridH}）
          </option>
        </select>
      </div>

      {aspectMode === "locked" ? (
        <div className="field">
          <label htmlFor="crop-ratio">锁定比例</label>
          <select
            id="crop-ratio"
            value={String(lockedRatio)}
            onChange={(event) => selectLockedRatio(Number(event.target.value))}
          >
            {LOCKED_RATIOS.map(([label, value]) => (
              <option key={label} value={String(value)}>
                {label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="field">
        <label htmlFor="fit-mode">适配方式</label>
        <select
          id="fit-mode"
          value={fitMode}
          onChange={(event) => {
            const mode = event.target.value === "contain" ? "contain" : "fill";
            setFitMode(mode);
            if (aspectMode === "pattern") {
              setCrop(computeAutoCrop(image.width, image.height, gridW / gridH, mode));
            }
          }}
        >
          <option value="fill">fill · 裁满图纸（默认）</option>
          <option value="contain">contain · 完整保留，四周留白</option>
        </select>
      </div>

      <button
        type="button"
        className="btn btn--block"
        data-testid="crop-auto"
        onClick={() => {
          setAspectMode("pattern");
          setCrop(computeAutoCrop(image.width, image.height, gridW / gridH, fitMode));
        }}
      >
        按图纸比例自动适配
      </button>

      <div className="field-grid">
        {(
          [
            ["x", "X"],
            ["y", "Y"],
            ["width", "宽"],
            ["height", "高"],
          ] as ReadonlyArray<readonly [keyof CropRect, string]>
        ).map(([field, label]) => (
          <div className="field" key={field}>
            <label htmlFor={`crop-${field}`}>{label}</label>
            <input
              id={`crop-${field}`}
              type="number"
              min={field === "x" || field === "y" ? 0 : 1}
              step={1}
              value={crop[field]}
              onChange={(event) => updateField(field, event.target.value)}
            />
          </div>
        ))}
      </div>

      <p className="hint">
        源图像素坐标：x {crop.x} · y {crop.y} · {crop.width}×{crop.height}
        {ratio ? ` · 比例 ${ratio.toFixed(3)}` : " · 自由比例"}
      </p>
    </section>
  );
}
