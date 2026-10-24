/**
 * C6 · `importImage()` —— 第 8 章的图片入口门面。
 *
 * 只做**预检与命名**，不触碰浏览器解码 API：
 * 字节 → 魔数 / 尺寸 / 大小校验（C1 已有的 `validate`）→ 稳定 `imageId`。
 *
 * 分工：
 * - 本文件负责"这个文件能不能进分割"，产出 `imageId`；
 * - `src/features/image-import/decode-image.ts` 负责"解码成位图给 UI 上屏"；
 * - `detectSubjects()` 拿 `imageId` 作 `sourceImageId`，拿字节作 Worker 输入。
 *
 * 因此本模块没有 DOM 依赖，可在 Node 中做确定性回归。
 */

import {
  ImageImportError,
  assertFileSize,
  assertImageDimensions,
  readImageDimensionsFromHeader,
  requireImageFormat,
} from "../image";
import type { ImageDimensions, ImageFormat } from "../image";

/** 读文件头的长度；与 decode-image 的读取量一致，保证两侧看到同一份字节。 */
const HEADER_READ_BYTES = 256 * 1024;

export interface ImportImageInput {
  /** 原图编码字节（PNG / JPEG / WebP）。 */
  imageBytes: Uint8Array;
  /** 调用方提供的文件名，仅用于错误文案；不参与校验。 */
  fileName?: string;
  /** 注入稳定的 imageId；缺省随机生成。测试可固定。 */
  createId?: () => string;
}

export interface ImportImageResult {
  /** 稳定图片 id：后续 `detectSubjects()` 用它作 `sourceImageId`。 */
  imageId: string;
  format: ImageFormat;
  /** 文件头读出的尺寸；头部不完整（例如截断的 JPEG）时为 null。 */
  dimensions: ImageDimensions | null;
  byteLength: number;
}

function defaultCreateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `image-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function hexFromBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * 内容寻址的 `imageId`：同一份原图字节跨刷新 / 再导入保持不变，
 * 才能用 `listSubjectsForImage(imageId)` 找回已落库主体。
 */
export async function imageIdFromBytes(imageBytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(imageBytes.byteLength);
  copy.set(imageBytes);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return `img-${hexFromBuffer(digest)}`;
}

export function mimeTypeForFormat(format: ImageFormat): string {
  if (format === "jpeg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  return "image/png";
}

function assertBytes(imageBytes: Uint8Array): void {
  if (!(imageBytes instanceof Uint8Array) || imageBytes.byteLength === 0) {
    throw new ImageImportError("EMPTY_FILE", "文件是空的，请重新选择一张图片。");
  }
}

/**
 * 预检一张待识别的图片并分配 `imageId`。
 *
 * @throws {ImageImportError} 空文件 / 体积超限 / 格式不支持 / 尺寸越界。
 */
export function importImage(input: ImportImageInput): ImportImageResult {
  assertBytes(input.imageBytes);

  // 大小与格式校验都在解码前完成，避免超大图先耗尽内存再报错。
  assertFileSize(input.imageBytes.byteLength);
  const format = requireImageFormat(input.imageBytes);

  const header = input.imageBytes.subarray(0, HEADER_READ_BYTES);
  const dimensions = readImageDimensionsFromHeader(header, format);
  if (dimensions) {
    assertImageDimensions(dimensions.width, dimensions.height);
  }

  return {
    imageId: input.createId?.() ?? defaultCreateId(),
    format,
    dimensions,
    byteLength: input.imageBytes.byteLength,
  };
}
