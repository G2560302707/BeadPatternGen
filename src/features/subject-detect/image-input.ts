/**
 * C6 · 识别输入适配：把已解码的 `ImageBitmap` 变成分割 Worker 需要的编码字节。
 *
 * 为什么重新编码而不是复用原文件：
 * - 一期的 `ImageSession` 只保留位图与尺寸，不保留原始 `File`；
 * - `ImageBitmap` 已经应用 EXIF 方向，重新编码可以避免 Worker 二次解释方向；
 * - 分割预处理本来就会把透明像素合成到白底，因此这里先铺白底再编码，
 *   与原图 `preprocessRgbaToChw` 的语义一致。
 *
 * 结果按 `ImageSession` 缓存：同一张图重复识别不会重复编码。
 * 若后续 UI 愿意在导入时保留原始字节，只需替换本文件的 `segmentationInputFor`，
 * `detectSubjects` 契约不变。
 */

import type { ImageSession } from "../../state/workspace-store";

/** 优先使用 JPEG 以控制大图的内存；编码器不支持时回退 PNG。 */
const PREFERRED_MIME = "image/jpeg";
const FALLBACK_MIME = "image/png";
const JPEG_QUALITY = 0.95;

export interface SegmentationImageInput {
  imageId: string;
  bytes: Uint8Array;
  mimeType: string;
}

const imageIds = new WeakMap<ImageSession, string>();
const inputCache = new WeakMap<ImageSession, SegmentationImageInput>();

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `image-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 图片会话的稳定 id：优先用导入时的内容哈希，否则按会话缓存。 */
export function imageIdFor(image: ImageSession): string {
  if (image.sourceImageId) return image.sourceImageId;
  const existing = imageIds.get(image);
  if (existing) return existing;
  const id = randomId();
  imageIds.set(image, id);
  return id;
}

function encodeWithOffscreenCanvas(bitmap: ImageBitmap): Promise<Blob> {
  const width = Math.max(1, bitmap.width);
  const height = Math.max(1, bitmap.height);
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) {
    return Promise.reject(new Error("无法创建 OffscreenCanvas 2D 上下文"));
  }
  context.fillStyle = "#FFFFFF";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0);
  return canvas.convertToBlob({ type: PREFERRED_MIME, quality: JPEG_QUALITY });
}

function encodeWithHtmlCanvas(bitmap: ImageBitmap): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const width = Math.max(1, bitmap.width);
    const height = Math.max(1, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      reject(new Error("无法创建 Canvas 2D 上下文"));
      return;
    }
    context.fillStyle = "#FFFFFF";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("图片编码失败"));
      },
      PREFERRED_MIME,
      JPEG_QUALITY,
    );
  });
}

async function encodeBitmap(bitmap: ImageBitmap): Promise<Blob> {
  const blob =
    typeof OffscreenCanvas === "function"
      ? await encodeWithOffscreenCanvas(bitmap)
      : await encodeWithHtmlCanvas(bitmap);
  if (blob.type === PREFERRED_MIME) return blob;
  // 极少数浏览器忽略 type 参数；此时退回 PNG，保证 Worker 拿到可解码的字节。
  if (blob.type === FALLBACK_MIME) return blob;
  if (typeof OffscreenCanvas === "function") {
    const canvas = new OffscreenCanvas(Math.max(1, bitmap.width), Math.max(1, bitmap.height));
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "#FFFFFF";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0);
      return canvas.convertToBlob({ type: FALLBACK_MIME });
    }
  }
  return blob;
}

/** 取得分割 Worker 的输入字节；同一个 `ImageSession` 只编码一次。 */
export async function segmentationInputFor(image: ImageSession): Promise<SegmentationImageInput> {
  if (image.sourceBytes && image.sourceMimeType) {
    return {
      imageId: imageIdFor(image),
      bytes: image.sourceBytes,
      mimeType: image.sourceMimeType,
    };
  }
  const cached = inputCache.get(image);
  if (cached) return cached;

  const blob = await encodeBitmap(image.bitmap);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const prepared: SegmentationImageInput = {
    imageId: imageIdFor(image),
    bytes,
    mimeType: blob.type === PREFERRED_MIME ? PREFERRED_MIME : FALLBACK_MIME,
  };
  inputCache.set(image, prepared);
  return prepared;
}
