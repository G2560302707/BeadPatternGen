/**
 * S06 · 图片文件头校验（纯函数，无 DOM）。
 *
 * 文件类型只认魔数，不认扩展名 / MIME：
 * - JPEG：FF D8 FF
 * - PNG ：89 50 4E 47 0D 0A 1A 0A
 * - WebP：RIFF .... WEBP
 *
 * 同时从文件头读出尺寸 / EXIF Orientation，使超限文件能在解码前被拒绝，
 * 避免一张超大图先耗尽内存再报错。
 */

import { ImageImportError } from "./errors";

export type ImageFormat = "jpeg" | "png" | "webp";

/** 单文件上限 20MB（20 × 1024 × 1024 字节）。 */
export const MAX_IMAGE_FILE_BYTES = 20 * 1024 * 1024;
/** 单边下限 16px（再小无法识别主体，也撑不起拼豆网格）。 */
export const MIN_IMAGE_DIMENSION = 16;
/** 单边上限 8192px。 */
export const MAX_IMAGE_DIMENSION = 8192;
/** 总像素上限 4000 万。 */
export const MAX_IMAGE_PIXELS = 40_000_000;

export const FORMAT_LABEL: Record<ImageFormat, string> = {
  jpeg: "JPG",
  png: "PNG",
  webp: "WebP",
};

export interface ImageDimensions {
  width: number;
  height: number;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let out = "";
  for (let index = 0; index < length; index += 1) {
    const byte = bytes[start + index];
    if (byte === undefined) return "";
    out += String.fromCharCode(byte);
  }
  return out;
}

function u16be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function u32be(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] ?? 0) * 0x1000000 +
      ((bytes[offset + 1] ?? 0) << 16) +
      ((bytes[offset + 2] ?? 0) << 8) +
      (bytes[offset + 3] ?? 0)) >>>
    0
  );
}

/** 校验文件字节数（0 字节与超限都拒绝）。 */
export function assertFileSize(size: number): void {
  if (!Number.isFinite(size) || size < 0) {
    throw new ImageImportError("EMPTY_FILE", `文件大小无效：${String(size)} 字节`);
  }
  if (size === 0) {
    throw new ImageImportError("EMPTY_FILE", "文件是空的，请重新选择一张图片。");
  }
  if (size > MAX_IMAGE_FILE_BYTES) {
    const actual = (size / 1024 / 1024).toFixed(1);
    throw new ImageImportError(
      "FILE_TOO_LARGE",
      `文件 ${actual}MB 超过 20MB 上限，请压缩或换一张图片。`,
    );
  }
}

/** 只看魔数；不认识就返回 null。 */
export function detectImageFormat(bytes: Uint8Array): ImageFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return "webp";
  }
  return null;
}

/** 从魔数识别；失败抛 UNSUPPORTED_FORMAT。 */
export function requireImageFormat(bytes: Uint8Array): ImageFormat {
  const format = detectImageFormat(bytes);
  if (!format) {
    throw new ImageImportError(
      "UNSUPPORTED_FORMAT",
      "文件头不是有效的 JPG / PNG / WebP 图片（扩展名和 MIME 不作为依据），请重新选择。",
    );
  }
  return format;
}

function readJpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    let marker = bytes[offset + 1] ?? 0;
    offset += 2;
    while (marker === 0xff && offset < bytes.length) {
      marker = bytes[offset] ?? 0;
      offset += 1;
    }
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) continue;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > bytes.length) return null;
    const length = u16be(bytes, offset);
    if (length < 2 || offset + length > bytes.length) return null;
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (length < 7) return null;
      const height = u16be(bytes, offset + 3);
      const width = u16be(bytes, offset + 5);
      if (width > 0 && height > 0) return { width, height };
      return null;
    }
    offset += length;
  }
  return null;
}

function readPngDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 24) return null;
  if (ascii(bytes, 12, 4) !== "IHDR") return null;
  const width = u32be(bytes, 16);
  const height = u32be(bytes, 20);
  if (width > 0 && height > 0) return { width, height };
  return null;
}

function readWebpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 30) return null;
  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8X") {
    const width = 1 + ((bytes[24] ?? 0) | ((bytes[25] ?? 0) << 8) | ((bytes[26] ?? 0) << 16));
    const height = 1 + ((bytes[27] ?? 0) | ((bytes[28] ?? 0) << 8) | ((bytes[29] ?? 0) << 16));
    return { width, height };
  }
  if (chunk === "VP8 ") {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    const width = ((bytes[26] ?? 0) | ((bytes[27] ?? 0) << 8)) & 0x3fff;
    const height = ((bytes[28] ?? 0) | ((bytes[29] ?? 0) << 8)) & 0x3fff;
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (chunk === "VP8L") {
    if (bytes[20] !== 0x2f) return null;
    const b1 = bytes[21] ?? 0;
    const b2 = bytes[22] ?? 0;
    const b3 = bytes[23] ?? 0;
    const b4 = bytes[24] ?? 0;
    const width = 1 + ((b1 | ((b2 & 0x3f) << 8)) & 0x3fff);
    const height = 1 + ((((b2 & 0xc0) >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10)) & 0x3fff);
    return { width, height };
  }
  return null;
}

/**
 * 从文件头读取尺寸。格式不支持 / 头部不完整时返回 null。
 * 注意：JPEG 的 SOF 可能位于文件较后位置，调用方应传入足够长的头部切片。
 */
export function readImageDimensionsFromHeader(
  bytes: Uint8Array,
  format: ImageFormat,
): ImageDimensions | null {
  if (format === "jpeg") return readJpegDimensions(bytes);
  if (format === "png") return readPngDimensions(bytes);
  return readWebpDimensions(bytes);
}

/** 尺寸硬限制：单边 16–8192px，总像素 ≤ 4000 万。 */
export function assertImageDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new ImageImportError(
      "CORRUPT_HEADER",
      `图片尺寸无效：${String(width)}×${String(height)}。`,
    );
  }
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
    throw new ImageImportError(
      "DIMENSION_LIMIT",
      `图片 ${width}×${height}px 超过单边 8192px 上限，请先缩小图片。`,
    );
  }
  if (width < MIN_IMAGE_DIMENSION || height < MIN_IMAGE_DIMENSION) {
    throw new ImageImportError(
      "RESOLUTION_TOO_LOW",
      `图片 ${width}×${height}px 短边低于 ${MIN_IMAGE_DIMENSION}px，主体识别与拼豆网格都无法使用。请换一张更大的图。`,
    );
  }
  if (width * height > MAX_IMAGE_PIXELS) {
    throw new ImageImportError(
      "DIMENSION_LIMIT",
      `图片 ${width}×${height}px 共 ${width * height} 像素，超过 4000 万像素上限，请先缩小图片。`,
    );
  }
}

interface TiffReader {
  bytes: Uint8Array;
  littleEndian: boolean;
  end: number;
}

function tiffU16(reader: TiffReader, offset: number): number | null {
  if (offset < 0 || offset + 2 > reader.end) return null;
  const a = reader.bytes[offset] ?? 0;
  const b = reader.bytes[offset + 1] ?? 0;
  return reader.littleEndian ? a | (b << 8) : (a << 8) | b;
}

function tiffU32(reader: TiffReader, offset: number): number | null {
  if (offset < 0 || offset + 4 > reader.end) return null;
  const a = reader.bytes[offset] ?? 0;
  const b = reader.bytes[offset + 1] ?? 0;
  const c = reader.bytes[offset + 2] ?? 0;
  const d = reader.bytes[offset + 3] ?? 0;
  return reader.littleEndian
    ? (a + (b << 8) + (c << 16) + d * 0x1000000) >>> 0
    : ((a << 24) + (b << 16) + (c << 8) + d) >>> 0;
}

function parseTiffOrientation(bytes: Uint8Array, start: number, end: number): number | null {
  if (start + 8 > end) return null;
  const order = ascii(bytes, start, 2);
  if (order !== "II" && order !== "MM") return null;
  const reader: TiffReader = { bytes, littleEndian: order === "II", end };
  if (tiffU16(reader, start + 2) !== 42) return null;
  const ifdOffset = tiffU32(reader, start + 4);
  if (ifdOffset === null) return null;
  const directory = start + ifdOffset;
  const count = tiffU16(reader, directory);
  if (count === null) return null;
  const entries = directory + 2;
  const limit = Math.min(count, 512);
  for (let index = 0; index < limit; index += 1) {
    const entry = entries + index * 12;
    if (entry + 12 > end) return null;
    const tag = tiffU16(reader, entry);
    if (tag === 0x0112) {
      const type = tiffU16(reader, entry + 2);
      const valueCount = tiffU32(reader, entry + 4);
      if (type !== 3 || valueCount === null || valueCount < 1) return null;
      const value = tiffU16(reader, entry + 8);
      if (value !== null && value >= 1 && value <= 8) return value;
      return null;
    }
  }
  return null;
}

/**
 * 读取 JPEG APP1 Exif 的 Orientation（1–8）。
 * 无 EXIF / 非 JPEG / 解析失败返回 1（视为正常方向），绝不抛出。
 */
export function readJpegExifOrientation(bytes: Uint8Array): number {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1] ?? 0;
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) continue;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > bytes.length) return 1;
    const length = u16be(bytes, offset);
    if (length < 2 || offset + length > bytes.length) return 1;
    if (marker === 0xe1 && length >= 8) {
      const payload = offset + 2;
      const segmentEnd = offset + length;
      if (ascii(bytes, payload, 6) === "Exif\u0000\u0000") {
        const orientation = parseTiffOrientation(bytes, payload + 6, segmentEnd);
        if (orientation !== null) return orientation;
      }
    }
    offset += length;
  }
  return 1;
}

/** EXIF 5–8 需要交换宽高。 */
export function exifOrientationSwapsDimensions(orientation: number): boolean {
  return orientation >= 5 && orientation <= 8;
}
