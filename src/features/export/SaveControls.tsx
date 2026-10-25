import { useState } from "react";
import { defaultRepository } from "../../storage/project-repository";
import { defaultDraftRepository } from "../../storage/draft-repository";
import { encodePersistedGenerationSource, encodePersistedImage } from "../image-import/session-bytes";
import { StorageError } from "../../storage/errors";
import { useWorkspaceStore } from "../../state/workspace-store";
import { ImportProjectButton } from "./import-project";
import { ProjectLibrary } from "./ProjectLibrary";

function statusLabel(status: string, savedAt: string | null): string {
  if (status === "saving") return "保存中";
  if (status === "saved" && savedAt) {
    const time = savedAt.includes("T") ? savedAt.slice(11, 19) : savedAt;
    return `已保存 ${time}`;
  }
  if (status === "saved") return "已保存";
  return "未保存";
}

export function SaveControls() {
  const pattern = useWorkspaceStore((state) => state.pattern);
  const saveStatus = useWorkspaceStore((state) => state.saveStatus);
  const savedAt = useWorkspaceStore((state) => state.savedAt);
  const setSaveStatus = useWorkspaceStore((state) => state.setSaveStatus);
  const setError = useWorkspaceStore((state) => state.setError);
  const draftNotice = useWorkspaceStore((state) => state.draftNotice);
  const duplicatePattern = useWorkspaceStore((state) => state.duplicatePattern);
  const [hint, setHint] = useState<string | null>(null);

  const save = async () => {
    if (!pattern) return;
    const current = pattern;
    setSaveStatus("saving");
    try {
      const quota = await defaultRepository.get().estimate();
      if (quota.warn) {
        setError({
          code: "E_QUOTA_WARN",
          message: `本地存储已用 ${(quota.ratio * 100).toFixed(0)}%。可先导出 JSON，再删除旧项目或清理缩略图。`,
        });
      }
      // 原图与构图产物随项目一起存：下次从作品库打开时对照层比例保持一致。
      const image = useWorkspaceStore.getState().image;
      const crop = useWorkspaceStore.getState().crop;
      const source = await encodePersistedImage(image, crop);
      const generationSource = await encodePersistedGenerationSource(
        image,
        useWorkspaceStore.getState().generationSource,
      );
      const meta = await defaultRepository.get().save(current, source, generationSource);
      if (useWorkspaceStore.getState().pattern !== current) return;
      setSaveStatus("saved", meta.updatedAt);
      await defaultDraftRepository.get().clear();
    } catch (error) {
      setSaveStatus("unsaved");
      const quotaFail =
        error instanceof DOMException && (error.name === "QuotaExceededError" || error.code === 22);
      setError({
        code: quotaFail ? "E_QUOTA" : error instanceof StorageError ? error.code : "E_SAVE",
        message: quotaFail
          ? "写入超出浏览器配额。当前图纸仍在内存中，请导出 JSON 后删除旧项目再重试。"
          : error instanceof Error
            ? error.message
            : String(error),
      });
    }
  };

  return (
    <section className="control-section">
      <h3>本地项目</h3>
      <p className="hint" data-testid="save-status">
        保存状态：{statusLabel(saveStatus, savedAt)}
      </p>
      <p className="hint">只有 IndexedDB 事务完成才会变成「已保存」。失败时图纸仍留在内存里。</p>
      {hint ? <p className="hint">{hint}</p> : null}
      {draftNotice ? <p className="hint">{draftNotice}</p> : null}
      <button
        type="button"
        className="btn btn--primary btn--block"
        data-testid="save-project"
        disabled={!pattern || saveStatus === "saving"}
        onClick={() => {
          void save();
        }}
      >
        {saveStatus === "saving" ? "保存中…" : "保存到本机"}
      </button>
      <button
        type="button"
        className="btn btn--block"
        data-testid="save-copy"
        disabled={!pattern || saveStatus === "saving"}
        onClick={() => {
          void (async () => {
            const copy = duplicatePattern();
            if (!copy) return;
            try {
              const image = useWorkspaceStore.getState().image;
              const crop = useWorkspaceStore.getState().crop;
              const copySource = await encodePersistedImage(image, crop);
              const copyGeneration = await encodePersistedGenerationSource(
                image,
                useWorkspaceStore.getState().generationSource,
              );
              const meta = await defaultRepository.get().save(copy, copySource, copyGeneration);
              setHint(`已另存副本 ${copy.title}（${meta.id}），原图纸未覆盖。`);
            } catch (error) {
              setError({
                code: error instanceof StorageError ? error.code : "E_SAVE",
                message: error instanceof Error ? error.message : String(error),
              });
            }
          })();
        }}
      >
        另存副本
      </button>
      <button
        type="button"
        className="btn btn--block"
        data-testid="purge-thumbnails"
        onClick={() => {
          void (async () => {
            try {
              const n = await defaultRepository.get().purgeThumbnails();
              setHint(
                `已清理 ${n} 张缩略图。图纸记录仍在。若仍接近配额，请导出 JSON 后删除旧项目。`,
              );
            } catch (error) {
              setError({
                code: error instanceof StorageError ? error.code : "E_SAVE",
                message: error instanceof Error ? error.message : String(error),
              });
            }
          })();
        }}
      >
        清理缩略图
      </button>
      <ImportProjectButton />
      <ProjectLibrary />
    </section>
  );
}
