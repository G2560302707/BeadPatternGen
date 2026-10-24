import { useEffect, useRef } from "react";
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
      const current = useWorkspaceStore.getState().pattern;
      const locked = useWorkspaceStore.getState().lockedCells;
      if (!current) return;
      const base = useWorkspaceStore.getState().baseCells;
      const overlay = useWorkspaceStore.getState().overlayCells;
      const visible = useWorkspaceStore.getState().refineVisible;
      void defaultDraftRepository.get().save(
        current,
        locked ?? new Uint8Array(current.cells.length),
        {
          base: base ?? new Int16Array(current.cells),
          overlay,
          visible,
        },
      );
    }, AUTOSAVE_MS);
    return () => window.clearTimeout(timer.current);
  }, [pattern, lockedCells, undoStack.length]);
}
