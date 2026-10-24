import { beforeEach, describe, expect, it } from "vitest";
import { EMPTY_CELL } from "../core/pattern";
import type { BeadPattern } from "../core/pattern";
import type { DiagnosticReport } from "../core/quality";
import { useWorkspaceStore } from "./workspace-store";

const EMPTY_REPORT: DiagnosticReport = {
  isolated: [],
  fragments: [],
  thinRuns: [],
  highDelta: [],
  nonEmptyCells: 3,
};

function generatedPattern(): BeadPattern {
  return {
    schemaVersion: "1.0",
    id: "layers-p",
    title: "layers",
    width: 2,
    height: 2,
    cells: Int16Array.from([0, 1, 1, EMPTY_CELL]),
    palette: [
      { code: "A", name: "A", hex: "#111111", manufacturer: "x" },
      { code: "B", name: "B", hex: "#222222", manufacturer: "x" },
    ],
    mode: "logo",
    paletteId: "p",
    paletteVersion: "1",
    settings: {
      maxColors: 2,
      dithering: "none",
      colorMetric: "ciede2000",
      transparentPolicy: "empty",
    },
    source: { originalWidth: 2, originalHeight: 2, aspectRatio: 1 },
    createdAt: "t0",
    updatedAt: "t1",
  };
}

describe("workspace refine layer (R1)", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      pattern: null,
      stats: null,
      diagnostic: null,
      undoStack: [],
      redoStack: [],
      lockedCells: null,
      selection: null,
      baseCells: null,
      overlayCells: null,
      refineVisible: true,
    });
    useWorkspaceStore.getState().applyGenerated(generatedPattern(), EMPTY_REPORT, {
      beadCount: 3,
      colorCount: 2,
      byColor: [],
    });
  });

  it("captures the generated result as the read-only base", () => {
    const state = useWorkspaceStore.getState();
    expect(state.baseCells).not.toBeNull();
    expect(Array.from(state.baseCells!)).toEqual([0, 1, 1, EMPTY_CELL]);
    expect(state.refineVisible).toBe(true);
    expect(state.overlayCells).toBeNull();
  });

  it("composites edits into the overlay and keeps the base intact", () => {
    const store = useWorkspaceStore.getState();
    const baseSnapshot = Array.from(store.baseCells!);
    store.executeCommand({
      kind: "paint",
      changes: [{ index: 0, from: 0, to: 1 }],
    });
    const next = useWorkspaceStore.getState();
    // 合成结果（可见矩阵）反映精修。
    expect(Array.from(next.pattern!.cells)).toEqual([1, 1, 1, EMPTY_CELL]);
    // 基底不被破坏。
    expect(Array.from(next.baseCells!)).toEqual(baseSnapshot);
    // overlay 记录精修；与基底同色的写回视为透明。
    expect(Array.from(next.overlayCells!)).toEqual([1, EMPTY_CELL, EMPTY_CELL, EMPTY_CELL]);
  });

  it("exports the base matrix while the refine layer is hidden", () => {
    const store = useWorkspaceStore.getState();
    store.executeCommand({
      kind: "paint",
      changes: [{ index: 0, from: 0, to: 1 }],
    });
    useWorkspaceStore.getState().setRefineVisible(false);
    const hidden = useWorkspaceStore.getState();
    // 隐藏精修层后可见矩阵（导出输入）=== 基底。
    expect(Array.from(hidden.pattern!.cells)).toEqual(Array.from(hidden.baseCells!));
    expect(hidden.refineVisible).toBe(false);
    // 精修内容仍在 overlay 里，不丢失。
    expect(Array.from(hidden.overlayCells!)).toEqual([1, EMPTY_CELL, EMPTY_CELL, EMPTY_CELL]);

    useWorkspaceStore.getState().setRefineVisible(true);
    const shown = useWorkspaceStore.getState();
    expect(Array.from(shown.pattern!.cells)).toEqual([1, 1, 1, EMPTY_CELL]);
  });

  it("keeps undo working across visibility toggles without corrupting the base", () => {
    const store = useWorkspaceStore.getState();
    const baseSnapshot = Array.from(store.baseCells!);
    store.executeCommand({
      kind: "paint",
      changes: [{ index: 0, from: 0, to: 1 }],
    });
    useWorkspaceStore.getState().setRefineVisible(false);
    useWorkspaceStore.getState().undoPatternEdit();
    // 隐藏状态下 undo：可见矩阵仍是基底。
    const hidden = useWorkspaceStore.getState();
    expect(Array.from(hidden.pattern!.cells)).toEqual(baseSnapshot);
    useWorkspaceStore.getState().setRefineVisible(true);
    // 显示后 overlay 应为空：编辑已被撤销。
    const shown = useWorkspaceStore.getState();
    expect(Array.from(shown.pattern!.cells)).toEqual(baseSnapshot);
    expect(Array.from(shown.overlayCells!)).toEqual([
      EMPTY_CELL,
      EMPTY_CELL,
      EMPTY_CELL,
      EMPTY_CELL,
    ]);
    // 基底自始至终不变。
    expect(Array.from(shown.baseCells!)).toEqual(baseSnapshot);
    // redo 恢复精修。
    useWorkspaceStore.getState().redoPatternEdit();
    const redone = useWorkspaceStore.getState();
    expect(Array.from(redone.pattern!.cells)).toEqual([1, 1, 1, EMPTY_CELL]);
  });

  it("restores the refine layer from the base and allows undo", () => {
    const store = useWorkspaceStore.getState();
    const baseSnapshot = Array.from(store.baseCells!);
    store.executeCommand({
      kind: "paint",
      changes: [
        { index: 0, from: 0, to: 1 },
        { index: 1, from: 1, to: 0 },
      ],
    });
    useWorkspaceStore.getState().restoreRefineLayer();
    const restored = useWorkspaceStore.getState();
    expect(Array.from(restored.pattern!.cells)).toEqual(baseSnapshot);
    expect(Array.from(restored.overlayCells!)).toEqual([
      EMPTY_CELL,
      EMPTY_CELL,
      EMPTY_CELL,
      EMPTY_CELL,
    ]);
    // 可撤销：undo 恢复精修内容。
    useWorkspaceStore.getState().undoPatternEdit();
    const undone = useWorkspaceStore.getState();
    expect(Array.from(undone.pattern!.cells)).toEqual([1, 0, 1, EMPTY_CELL]);
    expect(Array.from(undone.overlayCells!)).toEqual([1, 0, EMPTY_CELL, EMPTY_CELL]);
  });

  it("no-ops when restoring a layer without differences", () => {
    const store = useWorkspaceStore.getState();
    const stackLength = store.undoStack.length;
    useWorkspaceStore.getState().restoreRefineLayer();
    expect(useWorkspaceStore.getState().undoStack.length).toBe(stackLength);
  });
});
