/**
 * S12 · 分页切片几何 —— 纯函数、零运行时依赖。
 *
 * 设计口径（与 PROOF.md 一致）：
 * - 页宽 / 页高是「容量上限」，重叠格计入页容量；
 * - 相邻页的起点步长 = 容量 - overlap，因此每对相邻页恰好共享 overlap 格；
 * - 最后一页在图纸边界处裁剪，不补空白格；
 * - 页数取贪心下界：1 + ceil((总格数 - 容量) / (容量 - overlap))。
 *
 * 确定性：
 * - 仅使用整数加、减、乘与整数除法上取整，不存在浮点累加；
 * - 遍历顺序固定为先行后列（row-major），页码从 1 连续递增；
 * - 不读取时间、随机数、环境或对象键顺序。
 *
 * 注意：本文件没有运行时 import。`import type` 只参与类型检查，
 * 编译后被完全擦除，因此 geometry 核心可以单独打包而不带入任何依赖。
 */

import type { PageSlice, SliceRequest } from "./types";

/**
 * overlap 的默认值。
 * 来源：技术规格 §8.2「重叠边距默认 2 格（可配置 1–4 格）」。
 */
const DEFAULT_OVERLAP = 2;

/**
 * overlap 的合法下界。
 * 来源：S12 边界契约明确允许 0（此时相邻页不重叠）。
 */
const MIN_OVERLAP = 0;

/**
 * overlap 的合法上界。
 * 来源：技术规格 §8.2 的配置范围 1–4；0 作为显式允许的退化值。
 */
const MAX_OVERLAP = 4;

/** 机器可读错误码。调用方应按 code 分支，而不是解析 message。 */
export type PaginationErrorCode =
  "E_INVALID_REQUEST" | "E_INVALID_DIMENSION" | "E_INVALID_OVERLAP" | "E_OVERLAP_TOO_LARGE";

/**
 * 分页几何的输入错误。
 *
 * message 以 code 开头，兼容 `expect(...).toThrow("E_OVERLAP_TOO_LARGE")`
 * 这类字符串断言；同时暴露 code，避免上层依赖文案。
 */
export class PaginationError extends Error {
  readonly code: PaginationErrorCode;

  constructor(code: PaginationErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "PaginationError";
    this.code = code;
  }
}

/** 校验正整数尺寸。上下界之外一律拒绝，避免 NaN / 小数混进几何计算。 */
function assertPositiveInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new PaginationError(
      "E_INVALID_DIMENSION",
      `${label} must be a positive safe integer; received ${String(value)}`,
    );
  }
}

/**
 * 校验 overlap 的基本类型并完成缺省填充。
 *
 * 类型上 overlap 是必填字段；这里仍接受 undefined，
 * 以便 JS 调用方或旧版反序列化数据沿用「默认 2」的契约。
 * null 不会被当作缺省值：它是显式错误输入。
 *
 * 注意：范围 0–4 的检查不在这里做。调用方必须先判「overlap ≥ 页容量」，
 * 因为该边界被规定为 E_OVERLAP_TOO_LARGE；例如 overlap=5、容量=4 时，
 * 即使 5 超出配置范围，也应以容量错误码返回。
 */
function resolveOverlap(request: SliceRequest): number {
  const raw = request.overlap;
  const overlap = raw === undefined ? DEFAULT_OVERLAP : raw;

  if (typeof overlap !== "number" || !Number.isSafeInteger(overlap)) {
    throw new PaginationError(
      "E_INVALID_OVERLAP",
      `overlap must be a safe integer; received ${String(overlap)}`,
    );
  }
  return overlap;
}

/**
 * 单个方向的页数。
 *
 * 若总格数不超过容量，一页即可；否则每页最多贡献 (capacity - overlap)
 * 个新格，故页数下界为 1 + ceil((total - capacity) / (capacity - overlap))。
 * 该式与 ceil((total - overlap) / (capacity - overlap)) 等价（total > capacity）。
 *
 * 只用整数运算；`Math.ceil` 作用在整数商上，不存在浮点累加顺序问题。
 */
function countPagesOnAxis(total: number, capacity: number, overlap: number): number {
  if (total <= capacity) return 1;
  const stride = capacity - overlap;
  return 1 + Math.ceil((total - capacity) / stride);
}

/**
 * 计算全部页切片。
 *
 * 前置条件（不满足时抛 PaginationError）：
 * - width / height / maxColsPerPage / maxRowsPerPage 是正安全整数；
 * - overlap 是 0–4 的安全整数；
 * - overlap 严格小于两个方向上的页容量，否则 E_OVERLAP_TOO_LARGE。
 *
 * 输出顺序固定：先按页行（row）升序，再按页列（col）升序。
 */
export function computePages(req: SliceRequest): PageSlice[] {
  if (req === null || typeof req !== "object") {
    throw new PaginationError(
      "E_INVALID_REQUEST",
      `request must be an object; received ${String(req)}`,
    );
  }

  // 校验顺序写死：尺寸 → overlap 基本类型 → 容量关系 → overlap 范围。
  // 调用方依赖错误定位，因此该校验顺序也是确定性契约的一部分。
  assertPositiveInteger(req.width, "width");
  assertPositiveInteger(req.height, "height");
  assertPositiveInteger(req.maxColsPerPage, "maxColsPerPage");
  assertPositiveInteger(req.maxRowsPerPage, "maxRowsPerPage");

  const overlap = resolveOverlap(req);

  if (overlap >= req.maxColsPerPage) {
    throw new PaginationError(
      "E_OVERLAP_TOO_LARGE",
      `overlap (${overlap}) must be smaller than maxColsPerPage (${req.maxColsPerPage})`,
    );
  }
  if (overlap >= req.maxRowsPerPage) {
    throw new PaginationError(
      "E_OVERLAP_TOO_LARGE",
      `overlap (${overlap}) must be smaller than maxRowsPerPage (${req.maxRowsPerPage})`,
    );
  }

  // 范围检查放在容量检查之后：o >= 容量必须优先得到任务规定的
  // E_OVERLAP_TOO_LARGE，而不是通用的「超出 0–4」错误码。
  if (overlap < MIN_OVERLAP || overlap > MAX_OVERLAP) {
    throw new PaginationError(
      "E_INVALID_OVERLAP",
      `overlap must be within [${MIN_OVERLAP}, ${MAX_OVERLAP}]; received ${overlap}`,
    );
  }

  const colCount = countPagesOnAxis(req.width, req.maxColsPerPage, overlap);
  const rowCount = countPagesOnAxis(req.height, req.maxRowsPerPage, overlap);

  /**
   * 步长。overlap < 容量已校验，故 stride ≥ 1，不会原地打转。
   * 该值是页与页的起点差，也是每页「非重叠核心区」的宽度 / 高度。
   */
  const strideX = req.maxColsPerPage - overlap;
  const strideY = req.maxRowsPerPage - overlap;

  const pages: PageSlice[] = [];

  // 先行后列：外层 y（row），内层 x（col）。顺序是输出契约。
  for (let row = 0; row < rowCount; row += 1) {
    const y0 = row * strideY;
    const rows = Math.min(req.maxRowsPerPage, req.height - y0);
    const isLastRow = row === rowCount - 1;

    for (let col = 0; col < colCount; col += 1) {
      const x0 = col * strideX;
      const cols = Math.min(req.maxColsPerPage, req.width - x0);
      const isLastCol = col === colCount - 1;

      /**
       * 重叠数直接由相邻两页的几何位置计算，而不是无条件写 overlap：
       * 这样 overlapRight / overlapBottom 永远等于真实共享列 / 行数，
       * 不可能出现字段与实际切片脱节的「看起来对」。
       * 最后一列 / 行没有下一页，按契约记为 0。
       */
      const overlapRight = isLastCol ? 0 : x0 + cols - (col + 1) * strideX;
      const overlapBottom = isLastRow ? 0 : y0 + rows - (row + 1) * strideY;

      pages.push({
        page: row * colCount + col + 1,
        row,
        col,
        x0,
        y0,
        cols,
        rows,
        overlapRight,
        overlapBottom,
        isLastCol,
        isLastRow,
      });
    }
  }

  return pages;
}
