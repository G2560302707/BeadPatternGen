/**
 * S12 · PDF 拼版切片几何 —— 输入 / 输出类型。
 *
 * 坐标一律是「图纸格坐标」，不是像素、毫米或 PDF 点：
 *   x 向右递增，y 向下递增，左上角为 (0, 0)。
 *
 * 不变量（由 paginate.ts 保证，PROOF.md 给出证明）：
 * - 每页的覆盖区域 = [x0, x0 + cols - 1] × [y0, y0 + rows - 1]；
 * - 所有覆盖区域都落在 [0, width - 1] × [0, height - 1] 内；
 * - 相邻页在允许的边上重叠 overlap 格，页与页之间没有缝隙。
 */

export interface SliceRequest {
  width: number; // 图纸总列数
  height: number; // 图纸总行数
  maxColsPerPage: number;
  maxRowsPerPage: number;
  overlap: number; // 重叠格数，1–4，默认 2
}

export interface PageSlice {
  page: number; // 从 1 开始
  row: number; // 页在拼版矩阵中的位置，从 0 开始
  col: number; // 页在拼版矩阵中的位置，从 0 开始
  x0: number; // 该页左上角在图纸中的格坐标
  y0: number; // 该页左上角在图纸中的格坐标
  cols: number; // 该页实际包含的格数（含重叠）
  rows: number; // 该页实际包含的格数（含重叠）
  overlapRight: number; // 向右 / 向下与下一页重叠的格数
  overlapBottom: number;
  isLastCol: boolean;
  isLastRow: boolean;
}
