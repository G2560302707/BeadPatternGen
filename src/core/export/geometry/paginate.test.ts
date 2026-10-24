import { describe, expect, it } from "vitest";
import { PaginationError, computePages } from "./paginate";
import type { PageSlice, SliceRequest } from "./types";

/**
 * 测试口径刻意与实现解耦：
 * 1. 覆盖检查使用独立的「覆盖计数数组」，逐格计数，绝不用总格数相减；
 * 2. 相邻页重叠由切片坐标反算，再与 overlapRight / overlapBottom 字段对照；
 * 3. 页数由下界公式独立计算，不复用实现的 countPagesOnAxis。
 */

/** 断言失败立即抛出；比在海量循环里堆 expect 更快，失败信息仍带坐标。 */
function invariant(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function at(pages: readonly PageSlice[], index: number): PageSlice {
  const page = pages[index];
  if (page === undefined) {
    throw new Error(`internal test error: missing page at index ${index}`);
  }
  return page;
}

function request(
  width: number,
  height: number,
  maxColsPerPage: number,
  maxRowsPerPage: number,
  overlap: number,
): SliceRequest {
  return { width, height, maxColsPerPage, maxRowsPerPage, overlap };
}

/** T4 的独立下界：1 + ceil((total - capacity) / (capacity - overlap))。 */
function expectedAxisPages(total: number, capacity: number, overlap: number): number {
  if (total <= capacity) return 1;
  return 1 + Math.ceil((total - capacity) / (capacity - overlap));
}

/**
 * 全量不变量检查。
 *
 * 包括：页数、行列定位、边界、物理重叠、覆盖计数。
 * 覆盖计数只使用 PageSlice 的公开字段 + overlapRight/Bottom 定义核心区：
 *   coreX = [x0, x0 + cols - overlapRight - 1]
 *   coreY = [y0, y0 + rows - overlapBottom - 1]
 * 若实现把重叠重复计入核心区，某些格子的计数会 > 1；
 * 若实现丢掉最后一列/行，某些格子的计数会 = 0。
 */
function assertPagination(req: SliceRequest): void {
  const { width, height, maxColsPerPage, maxRowsPerPage, overlap } = req;
  const pages = computePages(req);

  const expectedCols = expectedAxisPages(width, maxColsPerPage, overlap);
  const expectedRows = expectedAxisPages(height, maxRowsPerPage, overlap);
  const expectedPageCount = expectedCols * expectedRows;

  invariant(
    pages.length === expectedPageCount,
    `page count ${pages.length} !== expected ${expectedPageCount} for ${JSON.stringify(req)}`,
  );

  const strideX = maxColsPerPage - overlap;
  const strideY = maxRowsPerPage - overlap;
  const reference = pages[0];
  invariant(reference !== undefined, "pagination must not be empty");

  for (let index = 0; index < pages.length; index += 1) {
    const page = at(pages, index);
    const expectedRow = Math.floor(index / expectedCols);
    const expectedCol = index % expectedCols;

    invariant(page.page === index + 1, `page number: index ${index} has ${page.page}`);
    invariant(page.row === expectedRow, `row: index ${index} has ${page.row}`);
    invariant(page.col === expectedCol, `col: index ${index} has ${page.col}`);
    invariant(page.isLastCol === (expectedCol === expectedCols - 1), `isLastCol: index ${index}`);
    invariant(page.isLastRow === (expectedRow === expectedRows - 1), `isLastRow: index ${index}`);

    invariant(page.x0 === expectedCol * strideX, `x0: index ${index} has ${page.x0}`);
    invariant(page.y0 === expectedRow * strideY, `y0: index ${index} has ${page.y0}`);
    invariant(
      page.cols === Math.min(maxColsPerPage, width - page.x0),
      `cols: index ${index} has ${page.cols}`,
    );
    invariant(
      page.rows === Math.min(maxRowsPerPage, height - page.y0),
      `rows: index ${index} has ${page.rows}`,
    );

    // T3：不越界、不产生空白补格。
    invariant(page.x0 >= 0 && page.y0 >= 0, `negative origin: index ${index}`);
    invariant(page.cols >= 1 && page.rows >= 1, `empty page: index ${index}`);
    invariant(page.x0 + page.cols <= width, `right overflow: index ${index}`);
    invariant(page.y0 + page.rows <= height, `bottom overflow: index ${index}`);
  }

  // T2：所有水平 / 垂直相邻页的共享格数必须精确等于 overlap。
  for (const page of pages) {
    if (!page.isLastCol) {
      const next = at(pages, page.page); // page 是 1 起始，page.page 正好是下一项下标
      invariant(next.row === page.row, `horizontal neighbor row mismatch at page ${page.page}`);
      const shared = page.x0 + page.cols - next.x0;
      invariant(shared === page.overlapRight, `overlapRight field mismatch at page ${page.page}`);
      invariant(
        shared === overlap,
        `horizontal overlap ${shared} !== ${overlap} at page ${page.page}`,
      );
      invariant(
        shared === Math.min(overlap, next.cols),
        `T2 min(overlap, available) failed at page ${page.page}`,
      );
    } else {
      invariant(page.overlapRight === 0, `last col overlapRight !== 0 at page ${page.page}`);
    }

    if (!page.isLastRow) {
      const below = at(pages, page.page - 1 + expectedCols);
      invariant(below.col === page.col, `vertical neighbor col mismatch at page ${page.page}`);
      const shared = page.y0 + page.rows - below.y0;
      invariant(shared === page.overlapBottom, `overlapBottom field mismatch at page ${page.page}`);
      invariant(
        shared === overlap,
        `vertical overlap ${shared} !== ${overlap} at page ${page.page}`,
      );
      invariant(
        shared === Math.min(overlap, below.rows),
        `T2 min(overlap, available) failed vertically at page ${page.page}`,
      );
    } else {
      invariant(page.overlapBottom === 0, `last row overlapBottom !== 0 at page ${page.page}`);
    }
  }

  // T1：核心区必须对每一格恰好覆盖一次（不重不漏）。
  const coverage = new Array<number>(width * height).fill(0);
  for (const page of pages) {
    const coreCols = page.cols - page.overlapRight;
    const coreRows = page.rows - page.overlapBottom;
    invariant(coreCols >= 1 && coreRows >= 1, `empty core at page ${page.page}`);

    for (let y = page.y0; y < page.y0 + coreRows; y += 1) {
      for (let x = page.x0; x < page.x0 + coreCols; x += 1) {
        const index = y * width + x;
        coverage[index] = (coverage[index] ?? 0) + 1;
      }
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const count = coverage[y * width + x] ?? 0;
      invariant(
        count === 1,
        `coverage at (${x},${y}) is ${count}, expected exactly 1; req=${JSON.stringify(req)}`,
      );
    }
  }

  // 最后一页的核心必须真正触及图纸右下边界，防止「提前结束」也能通过页数断言。
  const last = at(pages, pages.length - 1);
  invariant(last.x0 + last.cols === width, "last page does not reach right edge");
  invariant(last.y0 + last.rows === height, "last page does not reach bottom edge");
  invariant(last.isLastCol && last.isLastRow, "last page flags are wrong");
  invariant(reference.x0 === 0 && reference.y0 === 0, "first page must start at (0,0)");
}

describe("S12 · 主示例：200×150，40×30 容量，overlap=2", () => {
  const req = request(200, 150, 40, 30, 2);

  it("得到 6×6=36 页，先行后列且页码连续", () => {
    const pages = computePages(req);
    expect(pages).toHaveLength(36);
    expect(pages.map((page) => page.page)).toEqual(
      Array.from({ length: 36 }, (_, index) => index + 1),
    );
    expect(pages.map((page) => [page.row, page.col])).toEqual(
      Array.from({ length: 36 }, (_, index) => [Math.floor(index / 6), index % 6]),
    );
  });

  it("起点、页尺寸与重叠字段符合证明中的闭式公式", () => {
    const pages = computePages(req);
    const startsX = [0, 38, 76, 114, 152, 190];
    const startsY = [0, 28, 56, 84, 112, 140];
    const widths = [40, 40, 40, 40, 40, 10];
    const heights = [30, 30, 30, 30, 30, 10];

    for (const page of pages) {
      expect(page.x0).toBe(startsX[page.col]);
      expect(page.y0).toBe(startsY[page.row]);
      expect(page.cols).toBe(widths[page.col]);
      expect(page.rows).toBe(heights[page.row]);
      expect(page.overlapRight).toBe(page.isLastCol ? 0 : 2);
      expect(page.overlapBottom).toBe(page.isLastRow ? 0 : 2);
    }
  });

  it("首页、页 7、末页的完整对象逐字段相等", () => {
    const pages = computePages(req);
    expect(pages[0]).toEqual({
      page: 1,
      row: 0,
      col: 0,
      x0: 0,
      y0: 0,
      cols: 40,
      rows: 30,
      overlapRight: 2,
      overlapBottom: 2,
      isLastCol: false,
      isLastRow: false,
    });
    expect(pages[6]).toEqual({
      page: 7,
      row: 1,
      col: 0,
      x0: 0,
      y0: 28,
      cols: 40,
      rows: 30,
      overlapRight: 2,
      overlapBottom: 2,
      isLastCol: false,
      isLastRow: false,
    });
    expect(pages[35]).toEqual({
      page: 36,
      row: 5,
      col: 5,
      x0: 190,
      y0: 140,
      cols: 10,
      rows: 10,
      overlapRight: 0,
      overlapBottom: 0,
      isLastCol: true,
      isLastRow: true,
    });
  });

  it("全量覆盖 / 重叠 / 边界不变量通过", () => {
    assertPagination(req);
  });

  it("相同请求两次调用深比较相等，且返回不同数组实例", () => {
    const first = computePages(req);
    const second = computePages(req);
    expect(second).toStrictEqual(first);
    expect(second).not.toBe(first);
  });
});

describe("S12 · 自检 2/3/4：1–60 全尺寸 × overlap 0–4 覆盖矩阵", () => {
  it("所有 width/height 组合的核心区覆盖计数恰好为 1，且相邻页重叠精确", () => {
    const maxColsPerPage = 7;
    const maxRowsPerPage = 5;

    // 5 与 7 都大于最大 overlap=4，保证该矩阵只考察合法请求；
    // 边界与非法 overlap 由后续专门用例覆盖。
    for (let overlap = 0; overlap <= 4; overlap += 1) {
      for (let width = 1; width <= 60; width += 1) {
        for (let height = 1; height <= 60; height += 1) {
          assertPagination(request(width, height, maxColsPerPage, maxRowsPerPage, overlap));
        }
      }
    }
  }, 30_000);

  it("额外容量采样（含单格容量与超宽容量）同样满足全部不变量", () => {
    const dimensions = [1, 2, 3, 4, 5, 7, 8, 9, 39, 40, 41, 59, 60];
    const capacities = [1, 2, 3, 40, 61];

    for (const maxColsPerPage of capacities) {
      for (const maxRowsPerPage of capacities) {
        const maxOverlap = Math.min(4, maxColsPerPage - 1, maxRowsPerPage - 1);
        for (let overlap = 0; overlap <= maxOverlap; overlap += 1) {
          for (const width of dimensions) {
            for (const height of dimensions) {
              assertPagination(request(width, height, maxColsPerPage, maxRowsPerPage, overlap));
            }
          }
        }
      }
    }
  }, 30_000);
});

describe("S12 · T4 页数最少（闭式下界）", () => {
  it("页数始终等于两个方向下界之积，且少于该下界无法覆盖", () => {
    const widths = [1, 5, 7, 8, 39, 40, 41, 59, 60, 200];
    const heights = [1, 5, 7, 8, 29, 30, 31, 59, 60, 150];
    const capacities = [1, 2, 5, 7, 30, 40, 61];

    for (const maxColsPerPage of capacities) {
      for (const maxRowsPerPage of capacities) {
        const maxOverlap = Math.min(4, maxColsPerPage - 1, maxRowsPerPage - 1);
        for (let overlap = 0; overlap <= maxOverlap; overlap += 1) {
          for (const width of widths) {
            for (const height of heights) {
              const req = request(width, height, maxColsPerPage, maxRowsPerPage, overlap);
              const pages = computePages(req);
              const expected =
                expectedAxisPages(width, maxColsPerPage, overlap) *
                expectedAxisPages(height, maxRowsPerPage, overlap);
              expect(pages.length, JSON.stringify(req)).toBe(expected);
            }
          }
        }
      }
    }
  });
});

describe("S12 · 边界处理", () => {
  it("width < maxColsPerPage：该方向单列，cols=width，overlapRight=0", () => {
    const pages = computePages(request(5, 4, 10, 10, 2));
    expect(pages).toHaveLength(1);
    expect(pages[0]).toEqual({
      page: 1,
      row: 0,
      col: 0,
      x0: 0,
      y0: 0,
      cols: 5,
      rows: 4,
      overlapRight: 0,
      overlapBottom: 0,
      isLastCol: true,
      isLastRow: true,
    });

    // 宽度方向仍只有一列页；高度超出容量时，纵向照常分页。
    const tall = computePages(request(5, 15, 10, 10, 2));
    expect(tall).toHaveLength(2);
    expect(tall.map((page) => page.col)).toEqual([0, 0]);
    expect(tall.map((page) => page.overlapRight)).toEqual([0, 0]);
    expect(tall.map((page) => page.overlapBottom)).toEqual([2, 0]);
  });

  it("overlap = 0：合法，相邻页不共享任何格", () => {
    const req = request(11, 7, 4, 3, 0);
    const pages = computePages(req);
    expect(pages).toHaveLength(3 * 3);

    for (const page of pages) {
      expect(page.overlapRight).toBe(0);
      expect(page.overlapBottom).toBe(0);
    }
    // 水平相邻页首尾相接：前一页右边界 + 1 = 后一页 x0。
    for (const page of pages) {
      if (!page.isLastCol) {
        const next = at(pages, page.page);
        expect(page.x0 + page.cols).toBe(next.x0);
      }
    }
    assertPagination(req);
  });

  it("width=1、height=1、maxCols=1、maxRows=1、overlap=0：正常返回单页", () => {
    const pages = computePages(request(1, 1, 1, 1, 0));
    expect(pages).toEqual([
      {
        page: 1,
        row: 0,
        col: 0,
        x0: 0,
        y0: 0,
        cols: 1,
        rows: 1,
        overlapRight: 0,
        overlapBottom: 0,
        isLastCol: true,
        isLastRow: true,
      },
    ]);
  });

  it("overlap 缺省时按 2 处理（运行时兼容 JS 调用方）", () => {
    const withoutOverlap = {
      width: 20,
      height: 20,
      maxColsPerPage: 7,
      maxRowsPerPage: 7,
    } as unknown as SliceRequest;

    expect(computePages(withoutOverlap)).toStrictEqual(computePages(request(20, 20, 7, 7, 2)));
  });

  it("overlap ≥ maxColsPerPage 或 maxRowsPerPage：抛 E_OVERLAP_TOO_LARGE", () => {
    const cases: ReadonlyArray<readonly [SliceRequest, "cols" | "rows"]> = [
      [request(20, 20, 4, 5, 4), "cols"],
      [request(20, 20, 5, 4, 4), "rows"],
      [request(20, 20, 3, 9, 4), "cols"],
      // 同时超出 0–4 范围与页容量时，容量错误码优先。
      [request(20, 20, 4, 9, 5), "cols"],
      [request(20, 20, 9, 4, 5), "rows"],
    ];

    for (const [req, axis] of cases) {
      let caught: unknown;
      try {
        computePages(req);
      } catch (error) {
        caught = error;
      }
      expect(caught, `${axis} capacity must reject overlap=${req.overlap}`).toBeInstanceOf(
        PaginationError,
      );
      expect((caught as PaginationError).code).toBe("E_OVERLAP_TOO_LARGE");
    }
  });

  it("非法 overlap / 非法尺寸按机器可读错误码拒绝", () => {
    const overlapCases = [-1, 5, 1.5, Number.NaN];
    for (const overlap of overlapCases) {
      let caught: unknown;
      try {
        computePages(request(10, 10, 7, 7, overlap));
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(PaginationError);
      expect((caught as PaginationError).code).toBe("E_INVALID_OVERLAP");
    }

    const dimensionCases: ReadonlyArray<Partial<SliceRequest>> = [
      { width: 0 },
      { height: -1 },
      { maxColsPerPage: 1.5 },
      { maxRowsPerPage: Number.NaN },
    ];
    for (const overrides of dimensionCases) {
      let caught: unknown;
      try {
        computePages({ ...request(10, 10, 7, 7, 2), ...overrides });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(PaginationError);
      expect((caught as PaginationError).code).toBe("E_INVALID_DIMENSION");
    }
  });
});
