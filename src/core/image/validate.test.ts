import { describe, expect, it } from "vitest";
import {
  ImageImportError,
  MAX_IMAGE_FILE_BYTES,
  MAX_IMAGE_PIXELS,
  assertFileSize,
  assertImageDimensions,
  detectImageFormat,
  readImageDimensionsFromHeader,
  readJpegExifOrientation,
  requireImageFormat,
} from "./index";
import type { ImageImportErrorCode } from "./index";

function expectImportError(code: ImageImportErrorCode, action: () => unknown): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ImageImportError);
    expect((error as ImageImportError).code).toBe(code);
    return;
  }
  throw new Error(`expected ImageImportError(${code}), but no error was thrown`);
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set(PNG_SIGNATURE, 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8); // IHDR length
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  for (let shift = 0; shift < 4; shift += 1) {
    bytes[16 + shift] = (width >>> (24 - shift * 8)) & 0xff;
    bytes[20 + shift] = (height >>> (24 - shift * 8)) & 0xff;
  }
  return bytes;
}

function jpegHeader(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
    0x01,
    0x11,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
  ]);
}

function webpVp8xHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(30);
  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  // size 字段不参与校验
  bytes.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
  bytes.set([0x56, 0x50, 0x38, 0x58], 12); // VP8X
  const w = width - 1;
  const h = height - 1;
  bytes.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff], 24);
  bytes.set([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 27);
  return bytes;
}

function exifJpeg(orientation: number): Uint8Array {
  // TIFF little-endian：II + 42 + IFD0 offset 8 + 1 entry(0x0112 = orientation) + next IFD 0。
  const tiff = new Uint8Array(26);
  tiff.set([0x49, 0x49, 0x2a, 0x00], 0);
  tiff.set([0x08, 0x00, 0x00, 0x00], 4);
  tiff.set([0x01, 0x00], 8);
  tiff.set([0x12, 0x01, 0x03, 0x00], 10); // tag 0x0112, type SHORT
  tiff.set([0x01, 0x00, 0x00, 0x00], 14); // count 1
  tiff.set([orientation, 0x00, 0x00, 0x00], 18);
  tiff.set([0x00, 0x00, 0x00, 0x00], 22);

  const app1Length = 2 + 6 + tiff.length;
  const bytes = new Uint8Array(4 + app1Length);
  bytes.set([0xff, 0xd8, 0xff, 0xe1, (app1Length >> 8) & 0xff, app1Length & 0xff], 0);
  bytes.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 6); // "Exif\0\0"
  bytes.set(tiff, 12);
  return bytes;
}

describe("图片魔数识别", () => {
  it("识别 JPG / PNG / WebP，不看扩展名", () => {
    expect(detectImageFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(detectImageFormat(new Uint8Array(PNG_SIGNATURE))).toBe("png");
    expect(detectImageFormat(webpVp8xHeader(10, 10))).toBe("webp");
  });

  it("垃圾字节 / 伪造 MIME 的文本 → null，require 走 UNSUPPORTED_FORMAT", () => {
    const garbage = new TextEncoder().encode("this is not an image, just text");
    expect(detectImageFormat(garbage)).toBeNull();
    expectImportError("UNSUPPORTED_FORMAT", () => requireImageFormat(garbage));
  });
});

describe("文件大小硬限制", () => {
  it("0 字节 → EMPTY_FILE", () => {
    expectImportError("EMPTY_FILE", () => assertFileSize(0));
  });

  it("恰好 20MB 通过；多 1 字节 → FILE_TOO_LARGE", () => {
    expect(() => assertFileSize(MAX_IMAGE_FILE_BYTES)).not.toThrow();
    expectImportError("FILE_TOO_LARGE", () => assertFileSize(MAX_IMAGE_FILE_BYTES + 1));
  });
});

describe("尺寸硬限制", () => {
  it("单边 8193px → DIMENSION_LIMIT", () => {
    expectImportError("DIMENSION_LIMIT", () => assertImageDimensions(8193, 1));
  });

  it("总像素超过 4000 万 → DIMENSION_LIMIT", () => {
    const width = 8192;
    const height = Math.floor(MAX_IMAGE_PIXELS / width) + 1;
    expect(width * height).toBeGreaterThan(MAX_IMAGE_PIXELS);
    expectImportError("DIMENSION_LIMIT", () => assertImageDimensions(width, height));
  });

  it("恰好 4000 万像素以内通过", () => {
    const width = 8000;
    const height = 5000;
    expect(width * height).toBe(MAX_IMAGE_PIXELS);
    expect(() => assertImageDimensions(width, height)).not.toThrow();
  });

  it("非正整数尺寸 → CORRUPT_HEADER", () => {
    expectImportError("CORRUPT_HEADER", () => assertImageDimensions(0, 10));
  });

  it("短边低于 16px → RESOLUTION_TOO_LOW", () => {
    expectImportError("RESOLUTION_TOO_LOW", () => assertImageDimensions(8, 8));
    expectImportError("RESOLUTION_TOO_LOW", () => assertImageDimensions(32, 8));
  });

  it("恰好 16×16 通过下限", () => {
    expect(() => assertImageDimensions(16, 16)).not.toThrow();
  });
});

describe("文件头尺寸解析（解码前拒绝超大图）", () => {
  it("PNG IHDR", () => {
    expect(readImageDimensionsFromHeader(pngHeader(640, 480), "png")).toEqual({
      width: 640,
      height: 480,
    });
  });

  it("JPEG SOF0", () => {
    expect(readImageDimensionsFromHeader(jpegHeader(1280, 720), "jpeg")).toEqual({
      width: 1280,
      height: 720,
    });
  });

  it("WebP VP8X", () => {
    expect(readImageDimensionsFromHeader(webpVp8xHeader(300, 200), "webp")).toEqual({
      width: 300,
      height: 200,
    });
  });

  it("头部损坏 → null（交给上层继续解码或报错）", () => {
    expect(readImageDimensionsFromHeader(new Uint8Array([1, 2, 3]), "png")).toBeNull();
    expect(readImageDimensionsFromHeader(new Uint8Array([0xff, 0xd8, 0xff]), "jpeg")).toBeNull();
  });
});

describe("EXIF Orientation", () => {
  it("读出 APP1 中的 Orientation=6", () => {
    expect(readJpegExifOrientation(exifJpeg(6))).toBe(6);
  });

  it("无 EXIF / 非 JPEG → 1（正常方向）", () => {
    expect(readJpegExifOrientation(jpegHeader(10, 10))).toBe(1);
    expect(readJpegExifOrientation(new Uint8Array(PNG_SIGNATURE))).toBe(1);
  });
});
