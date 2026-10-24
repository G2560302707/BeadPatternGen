import { describe, expect, it } from "vitest";
import { findFragments } from "./fragments";
import * as quality from "./index";
import { findIsolated } from "./isolated";
import { buildReport } from "./report";
import { findThinRuns } from "./thin-runs";
import { DEFAULT_QUALITY_OPTIONS, EMPTY_CELL } from "./types";
import type { FragmentInfo, PatternView, ThinRunInfo } from "./types";

/** 用字符画构造 PatternView：数字 = 色号，"." = 空格（-1）。 */
function view(rows: readonly string[]): PatternView {
  const height = rows.length;
  const first = rows[0];
  if (first === undefined) {
    throw new Error("view: at least one row is required");
  }
  const width = first.length;
  const cells = new Int16Array(width * height);

  for (let row = 0; row < height; row += 1) {
    const line = rows[row];
    if (line === undefined || line.length !== width) {
      throw new Error("view: rows must be non-empty and equally wide");
    }
    for (let col = 0; col < width; col += 1) {
      const ch = line.charAt(col);
      cells[row * width + col] = ch === "." ? EMPTY_CELL : Number(ch);
    }
  }

  return { width, height, cells };
}

function h(row: number, col: number, length: number): ThinRunInfo {
  return { row, col, length, orientation: "h" };
}

function v(row: number, col: number, length: number): ThinRunInfo {
  return { row, col, length, orientation: "v" };
}

function frag(size: number, cells: number[]): FragmentInfo {
  return { size, cells };
}

// ---------------------------------------------------------------------------
// V1 — 3×3：对角相邻不算连通
// ---------------------------------------------------------------------------
describe("V1 diagonal beads are not 4-connected", () => {
  const p = view(["0..", ".0.", "..0"]);

  it("marks every diagonal bead as isolated", () => {
    expect(findIsolated(p)).toEqual([0, 4, 8]);
  });

  it("splits the diagonal into three size-1 fragments", () => {
    expect(findFragments(p, 2)).toEqual([frag(1, [0]), frag(1, [4]), frag(1, [8])]);
  });

  it("reports both horizontal and vertical short runs", () => {
    expect(findThinRuns(p, 2)).toEqual([
      h(0, 0, 1),
      v(0, 0, 1),
      h(1, 1, 1),
      v(1, 1, 1),
      h(2, 2, 1),
      v(2, 2, 1),
    ]);
  });
});

// ---------------------------------------------------------------------------
// V2 — 3×3：空格被色块包围，空格永远不是孤立豆
// ---------------------------------------------------------------------------
describe("V2 enclosed empty cell is skipped", () => {
  const p = view(["000", "0.0", "001"]);

  it("only reports the lone color-1 bead as isolated", () => {
    expect(findIsolated(p)).toEqual([8]);
    expect(findIsolated(p)).not.toContain(4);
  });

  it("does not create a fragment for the empty center cell", () => {
    expect(findFragments(p, 2)).toEqual([frag(1, [8])]);
  });

  it("does not create a thin run across empty cells", () => {
    expect(findThinRuns(p, 2)).toEqual([
      v(0, 1, 1),
      h(1, 0, 1),
      h(1, 2, 1),
      v(2, 1, 1),
      h(2, 2, 1),
      v(2, 2, 1),
    ]);
  });
});

// ---------------------------------------------------------------------------
// V3 — 4×4：单格宽的蛇形线
// ---------------------------------------------------------------------------
describe("V3 one-cell-wide serpentine line", () => {
  const p = view([".000", "...0", ".000", "...."]);

  it("has no isolated beads", () => {
    expect(findIsolated(p)).toEqual([]);
  });

  it("filters out the 7-cell component at maxSize=2", () => {
    expect(findFragments(p, 2)).toEqual([]);
  });

  it("proves the serpentine is one 4-connected component when allowed", () => {
    expect(findFragments(p, 7)).toEqual([frag(7, [1, 2, 3, 7, 9, 10, 11])]);
  });

  it("reports every one-cell vertical/horizontal stub with minRun=2", () => {
    expect(findThinRuns(p, 2)).toEqual([
      v(0, 1, 1),
      v(0, 2, 1),
      h(1, 3, 1),
      v(2, 1, 1),
      v(2, 2, 1),
    ]);
  });
});

// ---------------------------------------------------------------------------
// V4 — 5×5：十字细线，长游程不报、短游程全部报
// ---------------------------------------------------------------------------
describe("V4 plus-shaped line", () => {
  const p = view(["..0..", "..0..", "00000", "..0..", "..0.."]);

  it("has no isolated beads and no small fragments", () => {
    expect(findIsolated(p)).toEqual([]);
    expect(findFragments(p, 2)).toEqual([]);
  });

  it("reports only the short arms when minRun=3", () => {
    expect(findThinRuns(p, 3)).toEqual([
      h(0, 2, 1),
      h(1, 2, 1),
      v(2, 0, 1),
      v(2, 1, 1),
      v(2, 3, 1),
      v(2, 4, 1),
      h(3, 2, 1),
      h(4, 2, 1),
    ]);
  });
});

// ---------------------------------------------------------------------------
// V5 — 5×5：碎片排序（size 升序，同 size 按最小索引升序）
// ---------------------------------------------------------------------------
const V5_ISOLATED = [0, 13, 15, 22];

const V5_FRAGMENTS: FragmentInfo[] = [
  frag(1, [0]),
  frag(1, [13]),
  frag(1, [15]),
  frag(1, [22]),
  frag(2, [1, 6]),
  frag(2, [3, 4]),
];

const V5_THIN: ThinRunInfo[] = [
  h(0, 0, 1),
  v(0, 0, 1),
  h(0, 1, 1),
  v(0, 1, 2),
  h(0, 3, 2),
  v(0, 3, 1),
  v(0, 4, 1),
  h(1, 1, 1),
  h(2, 3, 1),
  v(2, 3, 1),
  h(3, 0, 1),
  v(3, 0, 1),
  h(4, 2, 1),
  v(4, 2, 1),
];

function v5View(): PatternView {
  return view(["01.22", ".1...", "...3.", "4....", "..4.."]);
}

/** V5 的 25 格 ΔE：覆盖 > 阈值、== 阈值、空格、NaN、Infinity 五种情况。 */
function v5Deltas(): Float32Array {
  const deltas = new Float32Array(25);
  deltas[0] = 10; // 等于阈值 → 不报
  deltas[1] = 10.5; // 大于阈值 → 报
  deltas[2] = 99; // 空格 → 忽略
  deltas[13] = 11; // 大于阈值 → 报
  deltas[15] = Number.NaN; // NaN 比较恒 false → 跳过
  deltas[17] = 99; // 空格（row3 col2）→ 忽略
  deltas[22] = Number.POSITIVE_INFINITY; // 非空格且 > 阈值 → 报
  return deltas;
}

describe("V5 fragment ordering and short runs", () => {
  const p = v5View();

  it("finds isolated beads in ascending index order", () => {
    expect(findIsolated(p)).toEqual(V5_ISOLATED);
  });

  it("sorts fragments by size, then by minimum index", () => {
    expect(findFragments(p, 2)).toEqual(V5_FRAGMENTS);
  });

  it("sorts thin runs by row, col, then h before v", () => {
    expect(findThinRuns(p, 3)).toEqual(V5_THIN);
  });
});

// ---------------------------------------------------------------------------
// buildReport — 高色差与空格的交互
// ---------------------------------------------------------------------------
describe("buildReport", () => {
  it("aggregates all four diagnostics with exact ordering and counts", () => {
    const report = buildReport(v5View(), v5Deltas(), DEFAULT_QUALITY_OPTIONS);

    expect(report).toEqual({
      isolated: V5_ISOLATED,
      fragments: V5_FRAGMENTS,
      thinRuns: V5_THIN,
      highDelta: [1, 13, 22],
      nonEmptyCells: 8,
    });
  });

  it("ignores perCellDelta on empty cells even at extreme values", () => {
    const p = view(["...", "...", "..."]);
    const deltas = new Float32Array(9).fill(999);
    const report = buildReport(p, deltas, DEFAULT_QUALITY_OPTIONS);

    expect(report).toEqual({
      isolated: [],
      fragments: [],
      thinRuns: [],
      highDelta: [],
      nonEmptyCells: 0,
    });
  });

  it("is deterministic and leaves both inputs untouched", () => {
    const p = v5View();
    const deltas = v5Deltas();
    const cellsBefore = Array.from(p.cells);
    const deltasBefore = Array.from(deltas);

    const first = buildReport(p, deltas, DEFAULT_QUALITY_OPTIONS);
    const second = buildReport(p, deltas, DEFAULT_QUALITY_OPTIONS);

    expect(second).toEqual(first);
    expect(Array.from(p.cells)).toEqual(cellsBefore);
    expect(Array.from(deltas)).toEqual(deltasBefore);
  });

  it("rejects a perCellDelta length mismatch", () => {
    const p = view(["0"]);
    expect(() => buildReport(p, new Float32Array(2), DEFAULT_QUALITY_OPTIONS)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// 边界：形状校验、空输入、大图无递归栈溢出
// ---------------------------------------------------------------------------
describe("boundaries", () => {
  it("rejects non-positive dimensions", () => {
    expect(() => findIsolated({ width: 0, height: 0, cells: new Int16Array(0) })).toThrow(
      RangeError,
    );
  });

  it("returns empty results for a 1×1 empty grid", () => {
    const p = view(["."]);
    expect(findIsolated(p)).toEqual([]);
    expect(findFragments(p, 2)).toEqual([]);
    expect(findThinRuns(p, 2)).toEqual([]);
    expect(buildReport(p, new Float32Array(1), DEFAULT_QUALITY_OPTIONS).nonEmptyCells).toBe(0);
  });

  it("handles a full 256×256 single-color grid without call-stack overflow", () => {
    const size = 256;
    const p: PatternView = {
      width: size,
      height: size,
      cells: new Int16Array(size * size), // 全部为色号 0
    };

    expect(findIsolated(p)).toEqual([]);
    expect(findThinRuns(p, 3)).toEqual([]);
    expect(findFragments(p, 2)).toEqual([]);

    const full = findFragments(p, size * size);
    expect(full).toHaveLength(1);
    expect(full[0]?.size).toBe(size * size);
    expect(full[0]?.cells.length).toBe(size * size);
    expect(full[0]?.cells[0]).toBe(0);
    expect(full[0]?.cells[size * size - 1]).toBe(size * size - 1);
  });

  it("exposes the public API and named defaults through the barrel", () => {
    expect(quality.EMPTY_CELL).toBe(-1);
    expect(quality.DEFAULT_MAX_FRAGMENT_SIZE).toBe(2);
    expect(quality.DEFAULT_MIN_THIN_RUN).toBe(3);
    expect(quality.DEFAULT_HIGH_DELTA_THRESHOLD).toBe(10);
    expect(quality.findIsolated(view(["0"]))).toEqual([0]);
    expect(typeof quality.buildReport).toBe("function");
  });
});
