import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { computeStats } from "../../core/pattern";
import { Mascot } from "../../design/mascot/Mascot";
import { BRAND } from "../../app/brand";
import { ImportProjectButton } from "../../features/export/import-project";
import { importPatternFile } from "../../features/export/import-pattern";
import { decodePersistedImage } from "../../features/image-import/session-bytes";
import { defaultRepository } from "../../storage/project-repository";
import { StorageError } from "../../storage/errors";
import { useWorkspaceStore } from "../../state/workspace-store";
import type { ProjectMeta } from "../../storage/db";
import { ActionCard } from "../../ui/StepIntro";
import { Modal } from "../../ui/Modal";

interface LibraryItem extends ProjectMeta {
  thumbUrl: string | null;
}

function toErrorMessage(error: unknown): string {
  return error instanceof StorageError || error instanceof Error
    ? error.message
    : String(error);
}

export default function HomePage() {
  const navigate = useNavigate();
  const loadPattern = useWorkspaceStore((s) => s.loadPattern);
  const setError = useWorkspaceStore((s) => s.setError);
  const saveStatus = useWorkspaceStore((s) => s.saveStatus);
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const jsonInputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(() => {
    void defaultRepository
      .get()
      .list()
      .then(async (rows) => {
        const withThumbs = await Promise.all(
          rows.map(async (row) => {
            try {
              const bytes = await defaultRepository.get().getThumbnail(row.id);
              return {
                ...row,
                thumbUrl: bytes ? URL.createObjectURL(new Blob([bytes], { type: "image/png" })) : null,
              };
            } catch {
              return { ...row, thumbUrl: null };
            }
          }),
        );
        setItems(withThumbs);
      })
      .catch((error: unknown) => {
        setItems([]);
        setError({ code: error instanceof StorageError ? error.code : "E_IDB", message: toErrorMessage(error) });
      });
  }, [setError]);

  useEffect(() => {
    reload();
  }, [reload, saveStatus]);

  const openProject = (item: LibraryItem) => {
    void (async () => {
      try {
        const loaded = await defaultRepository.get().load(item.id);
        // 原图快照恢复进内存：打开项目后「原图对照」可用。
        if (loaded.source) {
          const session = await decodePersistedImage(loaded.source);
          if (session) {
            useWorkspaceStore.getState().setImage(session, loaded.source.crop);
            useWorkspaceStore.getState().setImportPhase("ready");
          }
        }
        // 构图产物同样恢复：构图流程的对照层与选区再生成要用它。
        if (loaded.generationSource) {
          const generation = await decodePersistedImage(loaded.generationSource);
          if (generation) {
            useWorkspaceStore.getState().setGenerationSource(generation.bitmap);
          }
        }
        loadPattern(loaded.pattern, computeStats(loaded.pattern), true);
        navigate("/make/refine");
      } catch (error) {
        setError({ code: error instanceof StorageError ? error.code : "E_IDB", message: toErrorMessage(error) });
      }
    })();
  };

  const removeProject = (item: LibraryItem) => {
    void (async () => {
      try {
        await defaultRepository.get().remove(item.id);
        reload();
      } catch (error) {
        setError({ code: error instanceof StorageError ? error.code : "E_IDB", message: toErrorMessage(error) });
      }
    })();
  };

  return (
    <div className="page">
      <section className="hero">
        <Mascot mood="happy" size={120} className="hero__mascot" />
        <h1>{BRAND.name}</h1>
        <p className="hero__tagline">
          {BRAND.tagline} · 免费使用 · {BRAND.privacyLine}
        </p>
      </section>

      <section className="home-actions">
        <ActionCard
          emoji="✨"
          title="开始制作图纸"
          body="导入一张图片，跟着六步走，几分钟就能拿到可拼的图纸。"
          to="/make/import"
          testId="home-new"
          badge="新手从这里开始"
        />
        <ActionCard
          emoji="📂"
          title="导入工程 JSON"
          body="之前导出的 .json 工程文件可以随时回到这里继续编辑。"
          onClick={() => jsonInputRef.current?.click()}
          testId="home-import-json"
        />
        <ActionCard
          emoji="📖"
          title="新手教程"
          body="三分钟看懂：导入 → 抠图 → 画布 → 调色 → 精修 → 导出。"
          onClick={() => setGuideOpen(true)}
          testId="home-guide"
        />
      </section>
      <input
        ref={jsonInputRef}
        type="file"
        accept="application/json,.json"
        hidden
        data-testid="home-import-json-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            void importPatternFile(file).then(() => {
              if (useWorkspaceStore.getState().pattern) navigate("/make/refine");
            });
            event.target.value = "";
          }
        }}
      />

      <h2 className="home-section-title">💾 我的作品</h2>
      {items === null ? (
        <p className="hint">正在读取本地项目…</p>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <Mascot mood="idle" size={84} />
          <p className="empty-state__title">作品架还是空的</p>
          <p className="empty-state__body">
            「保存到本机」的图纸会出现在这里，存在你自己的浏览器里，换设备需要带 JSON 工程文件。
          </p>
        </div>
      ) : (
        <div className="project-grid" data-testid="project-list">
          {items.map((item) => (
            <article className="project-card" key={item.id}>
              <div className="project-card__thumb">
                {item.thumbUrl ? (
                  <img src={item.thumbUrl} alt={`《${item.title}》缩略图`} />
                ) : (
                  <Mascot mood="idle" size={56} />
                )}
              </div>
              <p className="project-card__title" title={item.title}>
                {item.title}
              </p>
              <p className="project-card__meta">
                {item.width}×{item.height} · {new Date(item.updatedAt).toLocaleDateString()}
              </p>
              <div className="project-card__actions">
                <button
                  type="button"
                  className="btn btn--small btn--primary"
                  data-testid={`open-project-${item.id}`}
                  onClick={() => openProject(item)}
                >
                  打开
                </button>
                <button
                  type="button"
                  className="btn btn--small"
                  data-testid={`delete-project-${item.id}`}
                  onClick={() => removeProject(item)}
                >
                  删除
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal open={guideOpen} title="三分钟上手豆豆图纸" onClose={() => setGuideOpen(false)}>
        <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
          <li>
            <strong>导入</strong>：选一张 JPG / PNG / WebP，全程本地处理不上传。
          </li>
          <li>
            <strong>抠图构图（可选）</strong>：一键抠出主体摆到画布 C 位；不需要就跳过。
          </li>
          <li>
            <strong>画布裁剪</strong>：定格数（一颗豆 = 一格），可用市售板子预设。
          </li>
          <li>
            <strong>调色生成</strong>：选画风（照片 / 二次元 / 图标 / 风景）和颜色数，一键生成。
          </li>
          <li>
            <strong>精修</strong>：画笔、橡皮、吸色逐格调；系统会提示孤立豆等隐患。
          </li>
          <li>
            <strong>导出分享</strong>：分享图 PNG、制作 PDF、采购 CSV、工程 JSON，还能存进作品架。
          </li>
        </ol>
        <p className="hint">
          {BRAND.mascotName}提示：网格越大越精细，豆子也越多，新手建议从 32–64 格开始玩。
          <Link to="/help">看完整使用说明 →</Link>
        </p>
      </Modal>

      <div style={{ display: "flex", justifyContent: "center" }}>
        <ImportProjectButton />
      </div>
    </div>
  );
}
