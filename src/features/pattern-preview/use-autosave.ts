import { useEffect, useRef } from "react";
import {
  encodePersistedGenerationSource,
  encodePersistedImage,
} from "../image-import/session-bytes";
import { defaultDraftRepository } from "../../storage/draft-repository";
import { useWorkspaceStore } from "../../state/workspace-store";

const AUTOSAVE_MS = 1200;

export function usePatternAutosave(): void {
  const pattern = useWorkspaceStore((state) => state.pattern);
  const lockedCells = useWorkspaceStore((state) => state.lockedCells);
  const undoStack = useWorkspaceStore((state) => state.undoStack);
  const timer = useRef(0);

  useEffect(() => {
    if (!pattern || undoStack.length === 0) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void (async () => {
        const current = useWorkspaceStore.getState().pattern;
        const locked = useWorkspaceStore.getState().lockedCells;
        if (!current) return;
        const base = useWorkspaceStore.getState().baseCells;
        const overlay = useWorkspaceStore.getState().overlayCells;
        const visible = useWorkspaceStore.getState().refineVisible;
        // 原图与构图产物都随草稿一起存：恢复后对照层与选区再生成
        // 使用的采样来源和生成时一致。
        const image = useWorkspaceStore.getState().image;
        const crop = useWorkspaceStore.getState().crop;
        const source = await encodePersistedImage(image, crop);
        const generationSource = await encodePersistedGenerationSource(
          image,
          useWorkspaceStore.getState().generationSource,
        );
        if (useWorkspaceStore.getState().pattern !== current) return;
        await defaultDraftRepository.get().save(
          current,
          locked ?? new Uint8Array(current.cells.length),
          {
            base: base ?? new Int16Array(current.cells),
            overlay,
            visible,
          },
          source,
          generationSource,
        );
      })();
    }, AUTOSAVE_MS);
    return () => window.clearTimeout(timer.current);
  }, [pattern, lockedCells, undoStack.length]);
}
