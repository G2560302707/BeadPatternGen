/**
 * S06 · 真实图片解码。
 *
 * 这是唯一允许接触浏览器解码 API 的图片入口：
 * 1. 先按文件大小 / 魔数 / 文件头尺寸做硬限制，能在解码前拒绝就不解码；
 * 2. 用 createImageBitmap(file, { imageOrientation: "from-image" }) 处理 EXIF；
 * 3. 若该选项不可用，回退到无选项解码，并按 EXIF Orientation 手动旋转（canvas）；
 *    无法纠正方向时明确拒绝，绝不让图片倒着进入采样；
 * 4. 任何失败都包装成 ImageImportError，交给 UI 渲染可恢复提示。
 */

import {
  FORMAT_LABEL,
  ImageImportError,
  assertFileSize,
  assertImageDimensions,
  exifOrientationSwapsDimensions,
  readImageDimensionsFromHeader,
  readJpegExifOrientation,
  requireImageFormat,
} from "../../core/image";
import type { ImageDimensions, ImageFormat } from "../../core/image";

/** 读取 256KB 文件头，足够覆盖 JPEG APP1/EXIF 与 SOF。 */
const HEADER_READ_BYTES = 256 * 1024;

export interface DecodableFile {
  readonly size: number;
  readonly type?: string;
  slice(start?: number, end?: number): { arrayBuffer(): Promise<ArrayBuffer> };
}

export interface DecodedImage {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  format: ImageFormat;
  exifOrientation: number;
  /** createImageBitmap 是否成功应用了 EXIF 方向（或已由我们手动纠正）。 */
  orientationApplied: boolean;
  /** 非致命提示（例如走了方向回退）；null 表示无。 */
  warning: string | null;
}

export interface DecodeDeps {
  createBitmap?: (source: Blob, options?: ImageBitmapOptions) => Promise<ImageBitmap>;
  rotateBitmap?: (bitmap: ImageBitmap, orientation: number) => Promise<ImageBitmap>;
}

async function rotateWithCanvas(bitmap: ImageBitmap, orientation: number): Promise<ImageBitmap> {
  if (typeof document === "undefined") {
    throw new Error("canvas unavailable");
  }
  const swap = exifOrientationSwapsDimensions(orientation);
  const width = swap ? bitmap.height : bitmap.width;
  const height = swap ? bitmap.width : bitmap.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("2d context unavailable");
  }

  switch (orientation) {
    case 2:
      context.transform(-1, 0, 0, 1, width, 0);
      break;
    case 3:
      context.transform(-1, 0, 0, -1, width, height);
      break;
    case 4:
      context.transform(1, 0, 0, -1, 0, height);
      break;
    case 5:
      context.transform(0, 1, 1, 0, 0, 0);
      break;
    case 6:
      context.transform(0, 1, -1, 0, height, 0);
      break;
    case 7:
      context.transform(0, -1, -1, 0, height, width);
      break;
    case 8:
      context.transform(0, -1, 1, 0, 0, width);
      break;
    default:
      break;
  }

  context.drawImage(bitmap, 0, 0);
  return createImageBitmap(canvas);
}

function closeBitmap(bitmap: ImageBitmap): void {
  if (typeof bitmap.close === "function") {
    bitmap.close();
  }
}

function decodeFailed(): ImageImportError {
  return new ImageImportError(
    "DECODE_FAILED",
    "图片无法解码，文件可能已损坏或不是真正的图片。请重新选择一张 JPG / PNG / WebP。",
  );
}

function orientationFailed(): ImageImportError {
  return new ImageImportError(
    "ORIENTATION_UNSUPPORTED",
    "图片带有 EXIF 旋转信息，但当前浏览器无法自动纠正方向。为避免倒置，已拒绝导入；请先用图片编辑器旋转后重试。",
  );
}

/**
 * 解码并校验一张图片。调用方必须把抛出的 ImageImportError 渲染为可恢复提示。
 */
export async function decodeImageFile(
  file: DecodableFile,
  deps: DecodeDeps = {},
): Promise<DecodedImage> {
  assertFileSize(file.size);

  const headerLength = Math.min(file.size, HEADER_READ_BYTES);
  const headerBytes = new Uint8Array(await file.slice(0, headerLength).arrayBuffer());
  const format = requireImageFormat(headerBytes);

  const headerDimensions = readImageDimensionsFromHeader(headerBytes, format);
  if (headerDimensions) {
    assertImageDimensions(headerDimensions.width, headerDimensions.height);
  }
  const exifOrientation = format === "jpeg" ? readJpegExifOrientation(headerBytes) : 1;

  const createBitmap =
    deps.createBitmap ??
    ((source: Blob, options?: ImageBitmapOptions): Promise<ImageBitmap> =>
      createImageBitmap(source, options));
  const rotateBitmap = deps.rotateBitmap ?? rotateWithCanvas;

  let bitmap: ImageBitmap;
  let orientationApplied = true;
  let warning: string | null = null;

  try {
    bitmap = await createBitmap(file as unknown as Blob, { imageOrientation: "from-image" });
  } catch {
    let fallback: ImageBitmap;
    try {
      fallback = await createBitmap(file as unknown as Blob);
    } catch {
      throw decodeFailed();
    }

    orientationApplied = false;
    warning = "当前浏览器未应用 EXIF 自动方向，已回退读取图片原始方向。";

    if (exifOrientation !== 1) {
      try {
        const rotated = await rotateBitmap(fallback, exifOrientation);
        closeBitmap(fallback);
        bitmap = rotated;
        warning = "当前浏览器未应用 EXIF 自动方向，已手动纠正图片方向。";
      } catch {
        closeBitmap(fallback);
        throw orientationFailed();
      }
    } else {
      bitmap = fallback;
    }
  }

  // 某些浏览器会静默忽略 imageOrientation。EXIF 5–8 必须交换宽高：
  // 若解码结果仍是未交换的头部尺寸，说明方向未被应用，立即手动纠正。
  // 正方形图片无法用宽高判断（交换前后相同），此时信任浏览器，避免二次旋转。
  if (
    orientationApplied &&
    headerDimensions &&
    headerDimensions.width !== headerDimensions.height &&
    exifOrientationSwapsDimensions(exifOrientation) &&
    bitmap.width === headerDimensions.width &&
    bitmap.height === headerDimensions.height
  ) {
    try {
      const rotated = await rotateBitmap(bitmap, exifOrientation);
      closeBitmap(bitmap);
      bitmap = rotated;
      orientationApplied = false;
      warning = "浏览器忽略了 EXIF 自动方向，已按 EXIF 手动纠正。";
    } catch {
      closeBitmap(bitmap);
      throw orientationFailed();
    }
  }

  if (
    !Number.isInteger(bitmap.width) ||
    !Number.isInteger(bitmap.height) ||
    bitmap.width < 1 ||
    bitmap.height < 1
  ) {
    closeBitmap(bitmap);
    throw decodeFailed();
  }

  try {
    assertImageDimensions(bitmap.width, bitmap.height);
  } catch (error) {
    closeBitmap(bitmap);
    throw error;
  }

  return {
    bitmap,
    width: bitmap.width,
    height: bitmap.height,
    format,
    exifOrientation,
    orientationApplied,
    warning,
  };
}

/** UI 用：尺寸 / 格式的人类可读文案。 */
export function describeDimensions(dimensions: ImageDimensions): string {
  return `${dimensions.width}×${dimensions.height}px`;
}

export function describeFormat(format: ImageFormat): string {
  return FORMAT_LABEL[format];
}
