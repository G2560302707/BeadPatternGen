/**
 * 画笔 / 橡皮的方形笔刷：把中心格展开成 size×size 的格子列表。
 *
 * 纯函数、确定性；画布边缘自动截断（不越界、不回绕）。
 * 锚定规则：奇数笔刷（1/3）以按下的格子为中心；偶数笔刷（2）没有中心格，
 * 按画图软件惯例把按下的格子作为笔刷左上角。
 */

export function expandBrushCells(
  centerIndex: number,
  size: number,
  width: number,
  height: number,
): number[] {
  if (!Number.isInteger(size) || size < 1 || size > 9) {
    throw new RangeError(`brush size must be an integer in [1, 9]; received ${String(size)}`);
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`width/height must be positive integers; received ${width}×${height}`);
  }
  const total = width * height;
  if (!Number.isInteger(centerIndex) || centerIndex < 0 || centerIndex >= total) {
    throw new RangeError(
      `centerIndex must be an index into ${width}×${height}; received ${String(centerIndex)}`,
    );
  }
  const cx = centerIndex % width;
  const cy = (centerIndex - cx) / width;
  const anchor = Math.floor((size - 1) / 2);
  const left = cx - anchor;
  const top = cy - anchor;
  const out: number[] = [];
  for (let y = top; y < top + size; y += 1) {
    if (y < 0 || y >= height) continue;
    for (let x = left; x < left + size; x += 1) {
      if (x < 0 || x >= width) continue;
      out.push(y * width + x);
    }
  }
  return out;
}
