import { useEffect, useState } from "react";
import { computeStats } from "../../core/pattern";
import { defaultRepository } from "../../storage/project-repository";
import type { ProjectMeta } from "../../storage/db";
import { StorageError } from "../../storage/errors";
import { useWorkspaceStore } from "../../state/workspace-store";

export function ProjectLibrary() {
  const [items, setItems] = useState<ProjectMeta[]>([]);
  const loadPattern = useWorkspaceStore((state) => state.loadPattern);
  const setError = useWorkspaceStore((state) => state.setError);
  const saveStatus = useWorkspaceStore((state) => state.saveStatus);

  useEffect(() => {
    let live = true;
    void defaultRepository
      .get()
      .list()
      .then((rows) => {
        if (live) setItems(rows);
      })
      .catch((error: unknown) => {
        if (!live) return;
        setError({
          code: error instanceof StorageError ? error.code : "E_IDB",
          message: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      live = false;
    };
  }, [saveStatus, setError]);

  const reloadList = () => {
    void defaultRepository
      .get()
      .list()
      .then(setItems)
      .catch((error: unknown) => {
        setError({
          code: error instanceof StorageError ? error.code : "E_IDB",
          message: error instanceof Error ? error.message : String(error),
        });
      });
  };

  if (items.length === 0) {
    return <p className="hint">本地还没有已保存项目。</p>;
  }

  return (
    <ul className="project-list" data-testid="project-list">
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            className="btn btn--block"
            data-testid={`open-project-${item.id}`}
            onClick={() => {
              void (async () => {
                try {
                  const loaded = await defaultRepository.get().load(item.id);
                  loadPattern(loaded.pattern, computeStats(loaded.pattern), true);
                } catch (error) {
                  setError({
                    code: error instanceof StorageError ? error.code : "E_IDB",
                    message: error instanceof Error ? error.message : String(error),
                  });
                }
              })();
            }}
          >
            打开 {item.title} · {item.width}×{item.height}
          </button>
          <button
            type="button"
            className="btn btn--small"
            data-testid={`delete-project-${item.id}`}
            onClick={() => {
              void (async () => {
                try {
                  await defaultRepository.get().remove(item.id);
                  reloadList();
                } catch (error) {
                  setError({
                    code: error instanceof StorageError ? error.code : "E_IDB",
                    message: error instanceof Error ? error.message : String(error),
                  });
                }
              })();
            }}
          >
            删除
          </button>
        </li>
      ))}
    </ul>
  );
}
