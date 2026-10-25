/**
 * 原图会话的持久化编码 / 解码。
 *
 * 为什么需要：ImageBitmap 无法序列化，页面一刷新内存里的原图就没了，
 * 精修页的「原图对照」随之失效。这里把原图字节（优先原始文件字节，
 * EXIF 已旋转的图用纠正后的位图重编码）随草稿 / 项目一起存进 IndexedDB，
 * 恢复时重新解码成 ImageSession，对照条在任何入口下都可用。
 *
 * 坐标契约：PersistedImage 里记录的是「crop 所参照的位图尺寸」，
 * 解码后若位图尺寸与之不符（数据损坏 / 格式变化）直接放弃恢复，
 * 绝不让错位的对照图进入画布。
 */

import type { ImageFormat } from "../../core/image";
import type { ImageSession } from "../../state/workspace-store";
import type { CropRect } from "../image-crop/crop-math";

/** 可结构化克隆的原图快照（存 IndexedDB 记录的 source 字段）。 */
export interface PersistedImage {
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
  format: ImageFormat;
  formatLabel: string;
  sourceImageId: string;
  /** crop 坐标参照的位图尺寸（即保存时 ImageSession 的 width/height）。 */
  width: number;
  height: number;
  crop: CropRect;
}

interface EncodedSession {
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
  format: ImageFormat;
  formatLabel: string;
  sourceImageId: string;
  width: number;
  height: number;
}

/** 每个图片会话只编码一次（WeakMap 缓存）；crop 每次保存单独附加。 */
const encodeCache = new WeakMap<ImageSession, Promise<EncodedSession | null>>();

function encodeBitmapToBytes(
  bitmap: ImageBitmap,
  mimeType: string,
): Promise<Blob> {
  if (typeof OffscreenCanvas === "function") {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) return Promise.reject(new Error("无法创建 OffscreenCanvas 2D 上下文"));
    context.drawImage(bitmap, 0, 0);
    return canvas.convertToBlob({ type: mimeType, quality: 0.92 });
  }
  if (typeof document === "undefined") {
    return Promise.reject(new Error("没有可用的画布实现"));
  }
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("无法创建 Canvas 2D 上下文"));
  context.drawImage(bitmap, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("图片编码失败"))),
      mimeType,
      0.92,
    );
  });
}

async function encodeSession(image: ImageSession): Promise<EncodedSession | null> {
  try {
    if (image.sourceBytes && image.sourceMimeType) {
      return {
        bytes: image.sourceBytes,
        mimeType: image.sourceMimeType,
        fileName: image.fileName,
        format: image.format,
        formatLabel: image.formatLabel,
        sourceImageId: image.sourceImageId,
        width: image.width,
        height: image.height,
      };
    }
    // EXIF 已旋转的会话没有原始字节：从纠正后的位图重编码。
    // 照片类走 JPEG 控制体积；其余格式走 PNG 保留透明度。
    const mimeType = image.sourceMimeType?.includes("jpeg") ? "image/jpeg" : "image/png";
    const blob = await encodeBitmapToBytes(image.bitmap, mimeType);
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      mimeType: blob.type || mimeType,
      fileName: image.fileName,
      format: image.format,
      formatLabel: image.formatLabel,
      sourceImageId: image.sourceImageId,
      width: image.width,
      height: image.height,
    };
  } catch {
    return null;
  }
}

/** 把当前图片会话编码成可持久化的快照；没有图片或编码失败返回 null。 */
export async function encodePersistedImage(
  image: ImageSession | null,
  crop: CropRect | null,
): Promise<PersistedImage | null> {
  if (!image || !crop) return null;
  let encoded = encodeCache.get(image);
  if (!encoded) {
    encoded = encodeSession(image);
    encodeCache.set(image, encoded);
  }
  const base = await encoded;
  if (!base) return null;
  return { ...base, crop };
}

/**
 * 把构图产物位图编码成可持久化快照（PNG 保留透明度）。
 * 构图流程中图纸真正的采样来源是它而不是原始照片，随草稿 / 项目
 * 一起存才能在恢复后保持对照层与选区再生成的比例一致。
 */
export async function encodePersistedGenerationSource(
  image: ImageSession | null,
  source: ImageBitmap | null,
): Promise<PersistedImage | null> {
  if (!source) return null;
  try {
    const blob = await encodeBitmapToBytes(source, "image/png");
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      mimeType: "image/png",
      fileName: image?.fileName ?? "composed-source.png",
      format: "png",
      formatLabel: image?.formatLabel ?? "PNG",
      sourceImageId: image?.sourceImageId ?? "",
      width: source.width,
      height: source.height,
      crop: { x: 0, y: 0, width: source.width, height: source.height },
    };
  } catch {
    return null;
  }
}

/**
 * 把持久化快照解码回图片会话。位图尺寸与快照记录不一致时返回 null
 * （crop 坐标会错位，宁可不给对照也不能给错的）。
 */
export async function decodePersistedImage(saved: PersistedImage): Promise<ImageSession | null> {
  try {
    const bitmap = await createImageBitmap(
      new Blob([saved.bytes as unknown as BlobPart], { type: saved.mimeType }),
    );
    if (bitmap.width !== saved.width || bitmap.height !== saved.height) {
      bitmap.close();
      return null;
    }
    return {
      bitmap,
      width: bitmap.width,
      height: bitmap.height,
      format: saved.format,
      exifOrientation: 1,
      orientationApplied: true,
      warning: null,
      fileName: saved.fileName,
      formatLabel: saved.formatLabel,
      sourceImageId: saved.sourceImageId,
      // 存的已经是「与位图方向一致」的字节，后续识别 / 重采样可直接复用。
      sourceBytes: saved.bytes,
      sourceMimeType: saved.mimeType,
    };
  } catch {
    return null;
  }
}
