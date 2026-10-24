/**
 * C4 · 模型预处理（纯计算，无 DOM）。
 *
 * 流程：RGBA 原图 → 双线性缩放到模型输入尺寸 → alpha 合成到白底 → RGB 归一化 → CHW float32。
 *
 * 为什么合成到白底：u2net 只接受 3 通道。透明像素若直接丢掉 alpha，RGB 往往是黑色，
 * 会在主体边缘形成黑边；合成到白底与常见 rembg 预处理一致，且不影响后续 Alpha 量化红线
 *（原始 alpha 由 C3/C5 负责，这里只服务于识别）。
 *
 * 缩放使用双线性而非最近邻：320×320 的输入对细节敏感，最近邻会放大锯齿、
 * 让细发丝断成噪点。算法确定性：同输入同参数逐字节一致。
 */

import type { RgbaImage, SegmentationModelSpec } from "./types";

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} 必须是正整数，实际为 ${String(value)}`);
  }
}

/** 校验 RGBA 图像结构；错误信息面向开发者，Worker 会统一包装成 E_INPUT_INVALID。 */
export function validateRgbaImage(image: RgbaImage): void {
  if (image === null || typeof image !== "object") throw new Error("image 必须是对象");
  assertPositiveInteger(image.width, "image.width");
  assertPositiveInteger(image.height, "image.height");
  if (!(image.data instanceof Uint8ClampedArray)) {
    throw new Error("image.data 必须是 Uint8ClampedArray");
  }
  const expected = image.width * image.height * 4;
  if (image.data.length !== expected) {
    throw new Error(
      `image.data.length 必须是 width*height*4=${expected}，实际为 ${image.data.length}`,
    );
  }
}

/** 双线性坐标映射：像素中心对齐，边界夹紧。 */
interface BilinearAxis {
  lower: number;
  upper: number;
  weight: number;
}

function axisSamples(sourceSize: number, targetSize: number): BilinearAxis[] {
  const result: BilinearAxis[] = new Array(targetSize);
  const ratio = sourceSize / targetSize;
  for (let i = 0; i < targetSize; i += 1) {
    const position = (i + 0.5) * ratio - 0.5;
    const floored = Math.floor(position);
    const lower = Math.min(Math.max(floored, 0), sourceSize - 1);
    const upper = Math.min(Math.max(floored + 1, 0), sourceSize - 1);
    result[i] = { lower, upper, weight: Math.min(Math.max(position - floored, 0), 1) };
  }
  return result;
}

/**
 * RGBA 缩放 + 白底合成 + 归一化，输出 CHW 布局的 float32（长度 `3 × outW × outH`）。
 *
 * @param image 源图，RGBA 行优先。
 * @param outW 模型输入宽。
 * @param outH 模型输入高。
 * @param mean RGB 均值，长度 3。
 * @param std RGB 标准差，长度 3。
 */
export function preprocessRgbaToChw(
  image: RgbaImage,
  outW: number,
  outH: number,
  mean: readonly [number, number, number],
  std: readonly [number, number, number],
): Float32Array {
  validateRgbaImage(image);
  assertPositiveInteger(outW, "outW");
  assertPositiveInteger(outH, "outH");
  for (let c = 0; c < 3; c += 1) {
    if (!Number.isFinite(mean[c]) || !Number.isFinite(std[c]) || std[c] === 0) {
      throw new Error("mean/std 必须是有限数字，且 std 不能为 0");
    }
  }

  const { width: srcW, height: srcH, data } = image;
  const xs = axisSamples(srcW, outW);
  const ys = axisSamples(srcH, outH);
  const planeSize = outW * outH;
  const out = new Float32Array(planeSize * 3);

  // 先做白底合成再采样：透明像素与半透明边缘都按 alpha 与白色混合。
  const sample = (x: number, y: number, channel: number): number => {
    const index = (y * srcW + x) * 4;
    const alpha = (data[index + 3] ?? 0) / 255;
    const value = data[index + channel] ?? 0;
    return value * alpha + 255 * (1 - alpha);
  };

  for (let y = 0; y < outH; y += 1) {
    const row = ys[y] as BilinearAxis;
    const y0 = row.lower;
    const y1 = row.upper;
    const wy = row.weight;
    for (let x = 0; x < outW; x += 1) {
      const col = xs[x] as BilinearAxis;
      const x0 = col.lower;
      const x1 = col.upper;
      const wx = col.weight;
      const w00 = (1 - wx) * (1 - wy);
      const w10 = wx * (1 - wy);
      const w01 = (1 - wx) * wy;
      const w11 = wx * wy;
      const dest = y * outW + x;

      for (let c = 0; c < 3; c += 1) {
        const value =
          sample(x0, y0, c) * w00 +
          sample(x1, y0, c) * w10 +
          sample(x0, y1, c) * w01 +
          sample(x1, y1, c) * w11;
        out[c * planeSize + dest] = (value / 255 - (mean[c] as number)) / (std[c] as number);
      }
    }
  }

  return out;
}

/** 按模型规格预处理，避免调用方重复写尺寸与归一化参数。 */
export function preprocessForModel(image: RgbaImage, model: SegmentationModelSpec): Float32Array {
  return preprocessRgbaToChw(image, model.inputWidth, model.inputHeight, model.mean, model.std);
}
