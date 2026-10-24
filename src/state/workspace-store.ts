import { create } from "zustand";
import type { ImageFormat } from "../core/image";
import {
  EMPTY_CELL,
  MAX_EDIT_HISTORY,
  MAX_GRID_HEIGHT,
  MAX_GRID_WIDTH,
  applyChanges,
  applyChangesToOverlay,
  applyChangesToStats,
  applyCommandToPattern,
  compositeCells,
  computeStats,
  deriveOverlay,
  emptyLocked,
  invertChanges,
  markLocked,
  type BeadPattern,
  type CellChange,
  type ClipboardPatch,
  type ColorMetricName,
  type DitheringMode,
  type EditCommand,
  type ImageMode,
  type PatternEditTool,
  type PatternStats,
  type TransparentPolicy,
} from "../core/pattern";
import { DEFAULT_QUALITY_OPTIONS, buildReport } from "../core/quality";
import type { RgbaImage } from "../core/composition";
import type { PipelineStage } from "../core/pipeline";
import type { DiagnosticReport } from "../core/quality";
import type { SaveStatus } from "../storage/project-repository";
import type { DecodedImage } from "../features/image-import/decode-image";
import type { ClassifiedImportError, ImportPhase } from "../features/image-import/import-classify";
import type { SampledGridResult } from "../features/image-import/sample-bitmap";
import { clampCrop } from "../features/image-crop/crop-math";
import type { CropAspectMode, CropRect, FitMode } from "../features/image-crop/crop-math";
import type { CompositionParams, SubjectCandidate } from "../core/subject";
import {
  DEFAULT_PALETTE_KEY,
  PALETTES,
  isPaletteKey,
  type PaletteKey,
} from "../features/palette-panel/locked-palette";
import type { AspectPreset, PositionPreset } from "../features/composition-workbench/layout";
import { createEmptyCandidate } from "../features/subject-panel/brush";
import {
  createCompositionSlice,
  createSubjectSlice,
  type SubjectDetectStatus,
  type SubjectErrorState,
  type SubjectProgressState,
} from "./subject-slice";

export type { SubjectDetectStatus, SubjectErrorState, SubjectProgressState };

export interface VisibleError {
  code: string;
  message: string;
}

export interface ImageSession extends DecodedImage {
  fileName: string;
  formatLabel: string;
  /** 内容寻址 id，等于 `importImage` / `imageIdFromBytes` 的结果。 */
  sourceImageId: string;
  /**
   * 可供 Worker 直接使用的原图字节。EXIF 需旋转时不要填，
   * 让 `segmentationInputFor` 从已纠正的位图重编码，避免蒙版坐标系对不上。
   */
  sourceBytes?: Uint8Array;
  sourceMimeType?: string;
}

export type { ImageFormat };

export type GenerationStatus = "idle" | "running" | "done" | "error";

export type WorkbenchMode = "classic" | "compose";

export interface GenerationProgressState {
  status: GenerationStatus;
  taskId: number;
  stage: PipelineStage | null;
  done: number;
  total: number;
  message: string;
  /** R7 · 本次生成从发起到结果落地的真实耗时（毫秒）；未测量时为 null。 */
  elapsedMs: number | null;
}

const IDLE_GENERATION: GenerationProgressState = {
  status: "idle",
  taskId: 0,
  stage: null,
  done: 0,
  total: 0,
  message: "",
  elapsedMs: null,
};

interface WorkspaceState {
  error: VisibleError | null;
  paletteOpen: boolean;

  image: ImageSession | null;
  importPhase: ImportPhase;
  importError: ClassifiedImportError | null;
  crop: CropRect | null;
  aspectMode: CropAspectMode;
  lockedRatio: number;
  fitMode: FitMode;
  gridW: number;
  gridH: number;
  alphaPolicy: TransparentPolicy;
  backgroundHex: string;
  mode: ImageMode;
  maxColors: number;
  dithering: DitheringMode;
  colorMetric: ColorMetricName;
  /** 当前生成用色卡；决定色号体系与豆子规格（2.6mm/5mm）。 */
  paletteId: PaletteKey;

  sample: SampledGridResult | null;
  draft: BeadPattern | null;
  pattern: BeadPattern | null;
  diagnostic: DiagnosticReport | null;
  stats: PatternStats | null;
  generation: GenerationProgressState;
  highlightedColorIndex: number | null;
  highlightedCells: number[] | null;
  saveStatus: SaveStatus;
  savedAt: string | null;

  workbenchMode: WorkbenchMode;
  subjectProgress: SubjectProgressState;
  subjectError: SubjectErrorState | null;
  subjectCandidates: SubjectCandidate[];
  selectedSubjectId: string | null;
  compositionParams: CompositionParams;
  compositionAspect: AspectPreset;
  compositionPosition: PositionPreset;
  compositionBackgroundImage: RgbaImage | null;
  manualBoxHint: boolean;
  /** S2 · 分割模型 id；null = 清单默认（默认即高精度模型）。 */
  segmentationModelId: string | null;
  editTool: PatternEditTool;
  paintColorIndex: number;
  undoStack: EditCommand[];
  redoStack: EditCommand[];
  lockedCells: Uint8Array | null;
  selection: number[] | null;
  clipboard: ClipboardPatch | null;
  draftNotice: string | null;
  /** R1 · 只读基底（生成结果）。null 时在首个命令处按当前可见矩阵惰性确定。 */
  baseCells: Int16Array | null;
  /** R1 · 精修层 overlay：EMPTY_CELL 透出基底；null 等价于全透明。 */
  overlayCells: Int16Array | null;
  /** R1 · 精修层显示开关。隐藏时可见矩阵 = 基底，导出随之。 */
  refineVisible: boolean;

  setError: (error: VisibleError) => void;
  clearError: () => void;
  togglePalette: () => void;

  setImage: (image: ImageSession, crop: CropRect) => void;
  clearImage: () => void;
  setImportPhase: (phase: ImportPhase) => void;
  setImportError: (error: ClassifiedImportError | null) => void;
  setCrop: (crop: CropRect) => void;
  setAspectMode: (mode: CropAspectMode) => void;
  setLockedRatio: (ratio: number) => void;
  setFitMode: (mode: FitMode) => void;
  setGridSize: (width: number, height: number) => void;
  setAlphaPolicy: (policy: TransparentPolicy) => void;
  setBackgroundHex: (hex: string) => void;
  setMode: (mode: ImageMode) => void;
  setMaxColors: (maxColors: number) => void;
  setPaletteId: (paletteId: PaletteKey) => void;
  setDithering: (dithering: DitheringMode) => void;
  setColorMetric: (metric: ColorMetricName) => void;
  applySample: (sample: SampledGridResult, draft: BeadPattern) => void;
  clearSample: () => void;
  applyGenerated: (
    pattern: BeadPattern,
    diagnostic: DiagnosticReport,
    stats: PatternStats,
    elapsedMs?: number | null,
  ) => void;
  setGeneration: (generation: GenerationProgressState) => void;
  setHighlightedColorIndex: (index: number | null) => void;
  setHighlightedCells: (cells: number[] | null) => void;
  clearGenerated: () => void;
  loadPattern: (pattern: BeadPattern, stats: PatternStats, saved: boolean) => void;
  setSaveStatus: (saveStatus: SaveStatus, savedAt?: string | null) => void;
  setWorkbenchMode: (mode: WorkbenchMode) => void;
  setSubjectProgress: (progress: SubjectProgressState) => void;
  setSubjectError: (error: SubjectErrorState) => void;
  setSubjectCandidates: (candidates: SubjectCandidate[]) => void;
  selectSubject: (id: string) => void;
  setSegmentationModelId: (modelId: string | null) => void;
  patchSelectedCandidate: (candidate: SubjectCandidate) => void;
  ensurePaintCandidate: () => void;
  resetSubject: () => void;
  setCompositionParams: (params: CompositionParams) => void;
  patchCompositionParams: (patch: Partial<CompositionParams>) => void;
  setCompositionAspect: (preset: AspectPreset) => void;
  setCompositionPosition: (preset: PositionPreset) => void;
  setCompositionBackgroundImage: (image: RgbaImage | null) => void;
  setManualBoxHint: (open: boolean) => void;
  setEditTool: (tool: PatternEditTool) => void;
  setPaintColorIndex: (index: number) => void;
  paintPatternCell: (index: number, value: number) => void;
  stampPatternCell: (index: number, value: number) => void;
  commitStroke: (kind: "paint" | "erase", changes: CellChange[]) => void;
  executeCommand: (command: EditCommand) => void;
  undoPatternEdit: () => void;
  redoPatternEdit: () => void;
  setSelection: (selection: number[] | null) => void;
  setClipboard: (clipboard: ClipboardPatch | null) => void;
  restoreDraft: (
    pattern: BeadPattern,
    locked: Uint8Array,
    layers?: { base: Int16Array; overlay: Int16Array | null; visible: boolean },
  ) => void;
  duplicatePattern: () => BeadPattern | null;
  /** R1 · 精修层显示 / 隐藏；隐藏时可见矩阵与导出都使用基底。 */
  setRefineVisible: (visible: boolean) => void;
  /** R1 · 清空精修层（走命令栈，可撤销）。 */
  restoreRefineLayer: () => void;
}

function nowIso(): string {
  return new Date().toISOString();
}

function nextStats(
  current: PatternStats | null,
  pattern: BeadPattern,
  next: BeadPattern,
  changes: readonly CellChange[],
): PatternStats {
  return current
    ? applyChangesToStats(current, pattern.palette.length, changes)
    : computeStats(next);
}

function diagnosticsFor(pattern: BeadPattern) {
  return buildReport(
    { width: pattern.width, height: pattern.height, cells: pattern.cells },
    new Float32Array(pattern.cells.length),
    DEFAULT_QUALITY_OPTIONS,
  );
}

function clampGrid(value: number, max: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(max, Math.max(1, Math.round(value)));
}

/** R1 · 取当前基底：长度不匹配（或未建立）时以可见矩阵快照兜底。 */
function baseFor(state: { baseCells: Int16Array | null }, pattern: BeadPattern): Int16Array {
  return state.baseCells && state.baseCells.length === pattern.cells.length
    ? state.baseCells
    : new Int16Array(pattern.cells);
}

/** R1 · 取当前 overlay：缺失或长度不匹配时从可见矩阵与基底反推。 */
function overlayFor(
  state: { baseCells: Int16Array | null; overlayCells: Int16Array | null },
  pattern: BeadPattern,
  base: Int16Array,
): Int16Array {
  return state.overlayCells && state.overlayCells.length === pattern.cells.length
    ? state.overlayCells
    : deriveOverlay(pattern.cells, base);
}

/** R1 · 命令 / undo / redo 共用的 overlay 记账：写回值等于基底处视为透明。 */
function overlayAfterCommand(
  state: { baseCells: Int16Array | null; overlayCells: Int16Array | null },
  pattern: BeadPattern,
  changes: readonly CellChange[],
): { base: Int16Array; overlay: Int16Array } {
  const base = baseFor(state, pattern);
  const overlay = applyChangesToOverlay(overlayFor(state, pattern, base), base, changes);
  return { base, overlay };
}

function clearGeneratedOutput() {
  return {
    sample: null as SampledGridResult | null,
    draft: null as BeadPattern | null,
    pattern: null as BeadPattern | null,
    diagnostic: null as DiagnosticReport | null,
    stats: null as PatternStats | null,
    highlightedColorIndex: null as number | null,
    highlightedCells: null as number[] | null,
    generation: IDLE_GENERATION,
    saveStatus: "unsaved" as SaveStatus,
    savedAt: null as string | null,
    undoStack: [] as EditCommand[],
    redoStack: [] as EditCommand[],
    lockedCells: null as Uint8Array | null,
    selection: null as number[] | null,
    clipboard: null as ClipboardPatch | null,
    baseCells: null as Int16Array | null,
    overlayCells: null as Int16Array | null,
    refineVisible: true,
  };
}

function clearOutput() {
  return {
    ...clearGeneratedOutput(),
    ...createSubjectSlice(),
    ...createCompositionSlice(),
  };
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  error: null,
  paletteOpen: false,

  image: null,
  importPhase: "idle",
  importError: null,
  crop: null,
  aspectMode: "free",
  lockedRatio: 1,
  fitMode: "fill",
  gridW: 50,
  gridH: 50,
  alphaPolicy: "empty",
  backgroundHex: "#FFFFFF",
  mode: "photo",
    maxColors: 24,
    dithering: "none",
    colorMetric: "ciede2000",
    paletteId: DEFAULT_PALETTE_KEY,

  sample: null,
  draft: null,
  pattern: null,
  diagnostic: null,
  stats: null,
  generation: IDLE_GENERATION,
  highlightedColorIndex: null,
  highlightedCells: null,
  saveStatus: "unsaved",
  savedAt: null,

  workbenchMode: "compose",
  ...createSubjectSlice(),
  ...createCompositionSlice(),
  editTool: "pan",
  paintColorIndex: 0,
  undoStack: [],
  redoStack: [],
  lockedCells: null,
  selection: null,
  clipboard: null,
  draftNotice: null,
  baseCells: null,
  overlayCells: null,
  refineVisible: true,

  setError: (error) => set({ error }),
  clearError: () => set({ error: null }),
  togglePalette: () => set((state) => ({ paletteOpen: !state.paletteOpen })),

  setImage: (image, crop) => {
    const previous = get().image;
    if (previous && previous.bitmap !== image.bitmap) {
      previous.bitmap.close();
    }
    set({
      image,
      crop: clampCrop(crop, image.width, image.height),
      aspectMode: "free",
      error: null,
      importPhase: "detecting",
      importError: null,
      workbenchMode: "compose",
      ...clearOutput(),
    });
  },

  clearImage: () => {
    const previous = get().image;
    if (previous) {
      previous.bitmap.close();
    }
    set({
      image: null,
      crop: null,
      aspectMode: "free",
      error: null,
      importPhase: "idle",
      importError: null,
      ...clearOutput(),
    });
  },

  setImportPhase: (importPhase) => set({ importPhase }),
  setImportError: (importError) =>
    set({
      importError,
      importPhase: importError ? "error" : get().image ? "detecting" : "idle",
    }),

  setCrop: (crop) =>
    set((state) => ({
      crop: state.image ? clampCrop(crop, state.image.width, state.image.height) : crop,
      ...clearOutput(),
    })),

  setAspectMode: (aspectMode) => set({ aspectMode, ...clearOutput() }),

  setLockedRatio: (lockedRatio) => set({ lockedRatio, ...clearOutput() }),

  setFitMode: (fitMode) => set({ fitMode, ...clearOutput() }),

  setGridSize: (width, height) =>
    set({
      gridW: clampGrid(width, MAX_GRID_WIDTH),
      gridH: clampGrid(height, MAX_GRID_HEIGHT),
      ...clearGeneratedOutput(),
    }),

  setAlphaPolicy: (alphaPolicy) => set({ alphaPolicy, ...clearOutput() }),

  setBackgroundHex: (backgroundHex) => set({ backgroundHex, ...clearOutput() }),

  setMode: (mode) =>
    set((state) => ({
      mode,
      dithering: mode === "anime" || mode === "logo" ? "none" : state.dithering,
      pattern: null,
      diagnostic: null,
      stats: null,
      generation: IDLE_GENERATION,
    })),

  setMaxColors: (maxColors) =>
    set({
      maxColors: clampGrid(maxColors, 500),
      pattern: null,
      diagnostic: null,
      stats: null,
      generation: IDLE_GENERATION,
    }),

  setPaletteId: (paletteId) =>
    set((state) => {
      if (!isPaletteKey(paletteId) || paletteId === state.paletteId) {
        return {};
      }
      const paletteSize = PALETTES[paletteId].definition.colors.length;
      return {
        paletteId,
        // 旧上限可能超过新色卡色数；切换即收紧。草稿/图纸携带旧色卡，一并清空。
        maxColors: Math.min(state.maxColors, paletteSize),
        ...clearOutput(),
      };
    }),

  setDithering: (dithering) =>
    set({
      dithering,
      pattern: null,
      diagnostic: null,
      stats: null,
      generation: IDLE_GENERATION,
    }),

  setColorMetric: (colorMetric) =>
    set({
      colorMetric,
      pattern: null,
      diagnostic: null,
      stats: null,
      generation: IDLE_GENERATION,
    }),

  applySample: (sample, draft) =>
    set({
      sample,
      draft,
      error: null,
      pattern: null,
      diagnostic: null,
      stats: null,
      generation: IDLE_GENERATION,
      highlightedColorIndex: null,
      highlightedCells: null,
    }),

  clearSample: () => set(clearOutput()),

  applyGenerated: (pattern, diagnostic, stats, elapsedMs = null) =>
    set({
      pattern,
      diagnostic,
      stats,
      error: null,
      highlightedColorIndex: null,
      highlightedCells: null,
      generation: {
        status: "done",
        taskId: get().generation.taskId,
        stage: "diagnose",
        done: 1,
        total: 1,
        message: "生成完成",
        elapsedMs,
      },
      saveStatus: "unsaved",
      savedAt: null,
      undoStack: [],
      redoStack: [],
      lockedCells: emptyLocked(pattern),
      selection: null,
      baseCells: new Int16Array(pattern.cells),
      overlayCells: null,
      refineVisible: true,
    }),

  setGeneration: (generation) => set({ generation }),

  setHighlightedColorIndex: (highlightedColorIndex) =>
    set({ highlightedColorIndex, highlightedCells: null }),

  setHighlightedCells: (highlightedCells) => set({ highlightedCells, highlightedColorIndex: null }),

  clearGenerated: () =>
    set({
      pattern: null,
      diagnostic: null,
      stats: null,
      highlightedColorIndex: null,
      highlightedCells: null,
      generation: IDLE_GENERATION,
      saveStatus: "unsaved",
      savedAt: null,
    }),

  loadPattern: (pattern, stats, saved) =>
    set({
      pattern,
      stats,
      diagnostic: null,
      error: null,
      highlightedColorIndex: null,
      highlightedCells: null,
      generation: {
        status: "done",
        taskId: get().generation.taskId,
        stage: "diagnose",
        done: 1,
        total: 1,
        message: "生成完成",
        elapsedMs: null,
      },
      saveStatus: saved ? "saved" : "unsaved",
      savedAt: saved ? pattern.updatedAt : null,
      undoStack: [],
      redoStack: [],
      lockedCells: emptyLocked(pattern),
      selection: null,
      draftNotice: null,
      // 打开已保存项目：项目里的矩阵就是可得到的基底；无图层侧车。
      baseCells: new Int16Array(pattern.cells),
      overlayCells: null,
      refineVisible: true,
    }),

  setSaveStatus: (saveStatus, savedAt) =>
    set({
      saveStatus,
      ...(savedAt !== undefined ? { savedAt } : {}),
    }),

  setWorkbenchMode: (workbenchMode) => set({ workbenchMode }),

  setSubjectProgress: (subjectProgress) =>
    set({
      subjectProgress,
      subjectError: null,
      importPhase: subjectProgress.status === "running" ? "detecting" : get().importPhase,
    }),

  setSubjectError: (subjectError) =>
    set({
      subjectError,
      subjectProgress: {
        ...get().subjectProgress,
        status: "error",
        message: subjectError.message,
      },
      importPhase: "ready",
    }),

  setSubjectCandidates: (subjectCandidates) =>
    set({
      subjectCandidates,
      selectedSubjectId: subjectCandidates[0]?.id ?? null,
      subjectError: null,
      subjectProgress: {
        ...get().subjectProgress,
        status: "success",
        message: subjectCandidates.length > 1 ? "检测到多个候选，请选择一个" : "识别完成",
      },
      importPhase: "ready",
    }),

  selectSubject: (selectedSubjectId) => set({ selectedSubjectId }),

  setSegmentationModelId: (segmentationModelId) => set({ segmentationModelId }),

  patchSelectedCandidate: (candidate) =>
    set({
      subjectCandidates: get().subjectCandidates.map((item) =>
        item.id === candidate.id ? candidate : item,
      ),
      selectedSubjectId: candidate.id,
    }),

  ensurePaintCandidate: () => {
    const state = get();
    if (!state.image) return;
    if (state.subjectCandidates.length > 0) return;
    const candidate = createEmptyCandidate(
      state.image.sourceImageId || state.image.fileName || `img-${Date.now()}`,
      state.image.width,
      state.image.height,
    );
    set({
      subjectCandidates: [candidate],
      selectedSubjectId: candidate.id,
      subjectError: null,
      subjectProgress: {
        status: "success",
        taskId: state.subjectProgress.taskId,
        stage: null,
        done: 1,
        total: 1,
        message: "手绘蒙版",
      },
      importPhase: "ready",
      manualBoxHint: true,
    });
  },

  resetSubject: () => set(createSubjectSlice()),

  setCompositionParams: (compositionParams) => set({ compositionParams }),

  patchCompositionParams: (patch) =>
    set({
      compositionParams: { ...get().compositionParams, ...patch },
    }),

  setCompositionAspect: (compositionAspect) => set({ compositionAspect }),

  setCompositionPosition: (compositionPosition) => set({ compositionPosition }),

  setManualBoxHint: (manualBoxHint) => set({ manualBoxHint }),

  setCompositionBackgroundImage: (compositionBackgroundImage) =>
    set({ compositionBackgroundImage }),

  setEditTool: (editTool) => set({ editTool }),

  setPaintColorIndex: (paintColorIndex) => set({ paintColorIndex }),

  stampPatternCell: (index, value) => {
    const pattern = get().pattern;
    if (!pattern || index < 0 || index >= pattern.cells.length) return;
    const from = pattern.cells[index] ?? -1;
    if (from === value) return;
    const change: CellChange = { index, from, to: value };
    const next = applyCommandToPattern(pattern, { kind: "paint", changes: [change] }, nowIso());
    const stats = nextStats(get().stats, pattern, next, [change]);
    const { base, overlay } = overlayAfterCommand(get(), pattern, [change]);
    set({
      pattern: next,
      stats,
      saveStatus: "unsaved",
      savedAt: null,
      baseCells: base,
      overlayCells: overlay,
    });
  },

  paintPatternCell: (index, value) => {
    const pattern = get().pattern;
    if (!pattern) return;
    const from = pattern.cells[index];
    if (from === undefined || from === value) return;
    get().executeCommand({ kind: "paint", changes: [{ index, from, to: value }] });
  },

  commitStroke: (kind, changes) => {
    if (changes.length === 0) return;
    const pattern = get().pattern;
    if (!pattern) return;
    const command: EditCommand = { kind, changes };
    const locked = markLocked(get().lockedCells ?? emptyLocked(pattern), changes);
    set({
      undoStack: [...get().undoStack, command].slice(-MAX_EDIT_HISTORY),
      redoStack: [],
      lockedCells: locked,
      diagnostic: diagnosticsFor(pattern),
      saveStatus: "unsaved",
      savedAt: null,
    });
  },

  executeCommand: (command) => {
    const pattern = get().pattern;
    if (!pattern || command.changes.length === 0) return;
    const { base, overlay } = overlayAfterCommand(get(), pattern, command.changes);
    const next = applyCommandToPattern(pattern, command, nowIso());
    const stats = nextStats(get().stats, pattern, next, command.changes);
    set({
      pattern: next,
      stats,
      undoStack: [...get().undoStack, command].slice(-MAX_EDIT_HISTORY),
      redoStack: [],
      lockedCells: markLocked(get().lockedCells ?? emptyLocked(pattern), command.changes),
      diagnostic: diagnosticsFor(next),
      saveStatus: "unsaved",
      savedAt: null,
      baseCells: base,
      overlayCells: overlay,
    });
  },

  undoPatternEdit: () => {
    const pattern = get().pattern;
    const stack = get().undoStack;
    const command = stack[stack.length - 1];
    if (!pattern || !command) return;
    const inverted = invertChanges(command.changes);
    const next = {
      ...pattern,
      cells: applyChanges(pattern.cells, inverted),
      updatedAt: nowIso(),
    };
    const stats = nextStats(get().stats, pattern, next, inverted);
    const { base, overlay } = overlayAfterCommand(get(), pattern, inverted);
    set({
      pattern: next,
      stats,
      undoStack: stack.slice(0, -1),
      redoStack: [...get().redoStack, command],
      diagnostic: diagnosticsFor(next),
      saveStatus: "unsaved",
      savedAt: null,
      baseCells: base,
      overlayCells: overlay,
    });
  },

  redoPatternEdit: () => {
    const pattern = get().pattern;
    const stack = get().redoStack;
    const command = stack[stack.length - 1];
    if (!pattern || !command) return;
    const { base, overlay } = overlayAfterCommand(get(), pattern, command.changes);
    const next = applyCommandToPattern(pattern, command, nowIso());
    const stats = nextStats(get().stats, pattern, next, command.changes);
    set({
      pattern: next,
      stats,
      redoStack: stack.slice(0, -1),
      undoStack: [...get().undoStack, command].slice(-MAX_EDIT_HISTORY),
      diagnostic: diagnosticsFor(next),
      saveStatus: "unsaved",
      savedAt: null,
      baseCells: base,
      overlayCells: overlay,
    });
  },

  setSelection: (selection) => set({ selection }),

  setClipboard: (clipboard) => set({ clipboard }),

  restoreDraft: (pattern, locked, layers) => {
    const base =
      layers && layers.base.length === pattern.cells.length
        ? layers.base
        : new Int16Array(pattern.cells);
    const overlay =
      layers && layers.overlay && layers.overlay.length === pattern.cells.length
        ? layers.overlay
        : deriveOverlay(pattern.cells, base);
    const visible = layers ? layers.visible : true;
    set({
      pattern,
      stats: computeStats(pattern),
      diagnostic: diagnosticsFor(pattern),
      lockedCells: locked.length === pattern.cells.length ? locked : emptyLocked(pattern),
      undoStack: [],
      redoStack: [],
      selection: null,
      saveStatus: "unsaved",
      savedAt: null,
      generation: {
        status: "done",
        taskId: get().generation.taskId,
        stage: "diagnose",
        done: 1,
        total: 1,
        message: "已恢复未提交编辑",
        elapsedMs: null,
      },
      draftNotice: "已从自动保存恢复未提交的编辑。",
      workbenchMode: "classic" as const,
      baseCells: base,
      overlayCells: overlay,
      refineVisible: visible,
    });
  },

  duplicatePattern: () => {
    const pattern = get().pattern;
    if (!pattern) return null;
    const stamp = nowIso();
    return {
      ...pattern,
      id: `copy-${stamp}`,
      title: `${pattern.title} 副本`,
      createdAt: stamp,
      updatedAt: stamp,
      cells: new Int16Array(pattern.cells),
    };
  },

  setRefineVisible: (visible) => {
    const state = get();
    const pattern = state.pattern;
    if (!pattern || visible === state.refineVisible) return;
    const base = baseFor(state, pattern);
    const overlay = overlayFor(state, pattern, base);
    const nextCells = visible ? compositeCells(base, overlay) : new Int16Array(base);
    const next = { ...pattern, cells: nextCells, updatedAt: nowIso() };
    set({
      refineVisible: visible,
      baseCells: base,
      overlayCells: overlay,
      pattern: next,
      stats: computeStats(next),
      diagnostic: diagnosticsFor(next),
      saveStatus: "unsaved",
      savedAt: null,
    });
  },

  restoreRefineLayer: () => {
    const state = get();
    const pattern = state.pattern;
    if (!pattern) return;
    const base = baseFor(state, pattern);
    const overlay = overlayFor(state, pattern, base);
    // 隐藏状态下也按合成结果构造变更：cells 保持基底不变，overlay 被清空。
    const merged = state.refineVisible ? pattern.cells : compositeCells(base, overlay);
    const changes: CellChange[] = [];
    for (let i = 0; i < merged.length; i += 1) {
      const from = merged[i] ?? EMPTY_CELL;
      const to = base[i] ?? EMPTY_CELL;
      if (from !== to) changes.push({ index: i, from, to });
    }
    if (changes.length === 0) return;
    get().executeCommand({ kind: "restore-base", changes });
  },
}));
