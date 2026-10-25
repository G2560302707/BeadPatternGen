import { useEffect } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ErrorNotice } from "../components/ErrorNotice";
import { PIPELINE_STAGE_LABELS, progressPercent } from "../core/pipeline";
import { disposeSubjectDetection } from "../features/subject-detect";
import { installMockE2eHooks } from "../features/subject-detect/e2e-hooks";
import { decodePersistedImage } from "../features/image-import/session-bytes";
import { paletteEntry } from "../features/palette-panel/locked-palette";import { disposeGeneration } from "../state/generation";
import { useWorkspaceStore } from "../state/workspace-store";
import { defaultDraftRepository } from "../storage/draft-repository";
import { BRAND } from "./brand";
import { Stepper, type StepperStep } from "../ui/Stepper";
import { ThemePicker } from "../ui/ThemePicker";

const STEP_ROUTES: Record<string, string> = {
  import: "/make/import",
  compose: "/make/compose",
  canvas: "/make/canvas",
  generate: "/make/generate",
  refine: "/make/refine",
  export: "/make/export",
};

/** 全局外壳：品牌栏 + 步进器 + 路由出口 + 状态栏。承担原 App 的启动副作用。 */
export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
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
  const paletteId = useWorkspaceStore((s) => s.paletteId);

  // 启动副作用：E2E mock 钩子 + 草稿恢复（与旧 App 一致）
  useEffect(() => {
    const uninstall = installMockE2eHooks();
    void defaultDraftRepository
      .get()
      .load()
      .then(async (restored) => {
        if (!restored) return;
        if (useWorkspaceStore.getState().pattern) return;
        // 原图快照优先解码回内存：刷新后「原图对照」继续可用。
        if (restored.source) {
          const session = await decodePersistedImage(restored.source);
          if (session && !useWorkspaceStore.getState().pattern) {
            useWorkspaceStore.getState().setImage(session, restored.source.crop);
            useWorkspaceStore.getState().setImportPhase("ready");
          }
        }
        // 构图产物同样恢复：构图流程的对照层与选区再生成要用它。
        if (restored.generationSource) {
          const generation = await decodePersistedImage(restored.generationSource);
          if (generation) {
            useWorkspaceStore.getState().setGenerationSource(generation.bitmap);
          }
        }
        if (useWorkspaceStore.getState().pattern) return;
        useWorkspaceStore.getState().restoreDraft(restored.pattern, restored.locked, restored.layers);
        navigate("/make/refine", { replace: true });
      })
      .catch(() => undefined);
    return () => {
      uninstall();
      disposeGeneration();
      disposeSubjectDetection();
    };
    // 只在挂载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentKey =
    Object.entries(STEP_ROUTES).find(([, route]) => location.pathname.startsWith(route))?.[0] ??
    "";

  const steps: StepperStep[] = [
    {
      key: "import",
      label: "导入",
      emoji: "📷",
      state: currentKey === "import" ? "current" : image ? "done" : "todo",
    },
    {
      key: "compose",
      label: "抠图构图",
      emoji: "✂️",
      optional: true,
      state: currentKey === "compose" ? "current" : image && sample ? "done" : "todo",
    },
    {
      key: "canvas",
      label: "画布裁剪",
      emoji: "📐",
      state: currentKey === "canvas" ? "current" : sample ? "done" : "todo",
    },
    {
      key: "generate",
      label: "调色生成",
      emoji: "🎨",
      state: currentKey === "generate" ? "current" : pattern ? "done" : "todo",
    },
    {
      key: "refine",
      label: "精修",
      emoji: "🖌️",
      state: currentKey === "refine" ? "current" : pattern ? "done" : "todo",
    },
    {
      key: "export",
      label: "导出分享",
      emoji: "🎁",
      state: currentKey === "export" ? "current" : "todo",
    },
  ];

  const generationLabel =
    generation.status === "running" && generation.stage
      ? `${PIPELINE_STAGE_LABELS[generation.stage]} ${progressPercent(generation.done, generation.total)}%`
      : generation.status === "done"
        ? `生成完成${generation.elapsedMs != null ? ` · 耗时 ${(generation.elapsedMs / 1000).toFixed(1)}s` : ""}`
        : pattern
          ? "图纸可精修"
          : "尚未生成";

  return (
    <div className="shell">
      <header className="shell__header">
        <div className="shell__header-row">
          <Link className="brand" to="/" aria-label={`${BRAND.name} 首页`}>
            <span className="brand__pegs" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
            <span>
              <p className="brand__name">{BRAND.name}</p>
              <p className="brand__sub">
                {BRAND.tagline} · {BRAND.en}
              </p>
            </span>
          </Link>
          <span className="shell__spacer" />
          <p className="header-chip">
            色卡 {paletteEntry(paletteId).definition.paletteId} ·{" "}
            {paletteEntry(paletteId).definition.colors.length} 色 · {paletteEntry(paletteId).beadSize}
          </p>
          <Link className="help-link" to="/help" title="使用说明">
            📖 使用说明
          </Link>
          <ThemePicker />
        </div>
        <Stepper steps={steps} onSelect={(key) => navigate(STEP_ROUTES[key] ?? "/")} />
      </header>

      <main className="shell__main">
        {error ? (
          <div className="page" style={{ marginBottom: 14 }}>
            <ErrorNotice code={error.code} message={error.message} onDismiss={clearError} />
          </div>
        ) : null}
        <Outlet />
      </main>

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
        <span>🔒 {BRAND.privacyLine}</span>
      </footer>
    </div>
  );
}
