import { useEffect } from "react";
import { ErrorNotice } from "../components/ErrorNotice";
import { CompositionWorkbench } from "../features/composition-workbench/CompositionWorkbench";
import { SettingsPanel } from "../features/generation-settings/SettingsPanel";
import { PalettePanel } from "../features/palette-panel/PalettePanel";
import { PatternPreview } from "../features/pattern-preview/PatternPreview";
import { PIPELINE_STAGE_LABELS, progressPercent } from "../core/pipeline";
import { disposeSubjectDetection } from "../features/subject-detect";
import { installMockE2eHooks } from "../features/subject-detect/e2e-hooks";
import { disposeGeneration } from "../state/generation";
import { defaultDraftRepository } from "../storage/draft-repository";
import { useWorkspaceStore } from "../state/workspace-store";
import lockedPalette from "../core/palette/fixtures/artkal-s@beadcolors-f97ff428.json";

export function App() {
  const error = useWorkspaceStore((s) => s.error);
  const clearError = useWorkspaceStore((s) => s.clearError);
  const image = useWorkspaceStore((s) => s.image);
  const sample = useWorkspaceStore((s) => s.sample);
  const draft = useWorkspaceStore((s) => s.draft);
  const pattern = useWorkspaceStore((s) => s.pattern);
  const stats = useWorkspaceStore((s) => s.stats);
  const generation = useWorkspaceStore((s) => s.generation);
  const saveStatus = useWorkspaceStore((s) => s.saveStatus);
  const savedAt = useWorkspaceStore((s) => s.savedAt);
  const workbenchMode = useWorkspaceStore((s) => s.workbenchMode);

  useEffect(() => {
    const uninstall = installMockE2eHooks();
    void defaultDraftRepository
      .get()
      .load()
      .then((draft) => {
        if (!draft) return;
        if (useWorkspaceStore.getState().pattern) return;
        useWorkspaceStore.getState().restoreDraft(draft.pattern, draft.locked);
      })
      .catch(() => undefined);
    return () => {
      uninstall();
      disposeGeneration();
      disposeSubjectDetection();
    };
  }, []);

  const generationLabel =
    generation.status === "running" && generation.stage
      ? `${PIPELINE_STAGE_LABELS[generation.stage]} ${progressPercent(generation.done, generation.total)}%`
      : generation.status === "done"
        ? `生成完成${generation.elapsedMs != null ? ` · 耗时 ${(generation.elapsedMs / 1000).toFixed(1)}s` : ""}`
        : pattern
          ? "图纸可精修"
          : "尚未生成";

  return (
    <div className="workbench">
      <header className="topbar">
        <div className="brand">
          <span className="brand__pegs" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <div>
            <p className="brand__name">拼豆图纸生成器</p>
            <p className="brand__sub">本地识别 · 构图 · 图纸</p>
          </div>
        </div>
        <p className="topbar__chip">
          色卡 {lockedPalette.paletteId} · {lockedPalette.colors.length} 色已锁定
        </p>
      </header>
      {error ? (
        <ErrorNotice code={error.code} message={error.message} onDismiss={clearError} />
      ) : null}
      {image && workbenchMode === "compose" ? (
        <CompositionWorkbench />
      ) : (
        <div className="workbench__body">
          <SettingsPanel />
          <PatternPreview />
          <PalettePanel />
        </div>
      )}
      <footer className="statusbar">
        <span>{image ? `原图 ${image.width}×${image.height}` : "未导入图片"}</span>
        <span>
          {pattern
            ? `图纸 ${pattern.width}×${pattern.height}`
            : draft
              ? `草稿 ${draft.width}×${draft.height}`
              : "网格未生成"}
        </span>
        <span>
          {stats ? `豆子 ${stats.beadCount}` : sample ? `空格 ${sample.emptyCount} 格` : "豆子 0"}
        </span>
        <span data-testid="generation-status">{generationLabel}</span>
        <span data-testid="save-status-bar">
          {saveStatus === "saving"
            ? "保存中"
            : saveStatus === "saved"
              ? `已保存 ${savedAt ?? ""}`
              : "未保存"}
        </span>
        <span>处理在本地浏览器内完成，不会上传图片</span>
      </footer>
    </div>
  );
}
