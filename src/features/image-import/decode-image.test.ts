import { describe, expect, it, vi } from "vitest";
import { ImageImportError, MAX_IMAGE_FILE_BYTES } from "../../core/image";
import { decodeImageFile } from "./decode-image";
import type { DecodableFile } from "./decode-image";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set(PNG_SIGNATURE, 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  for (let shift = 0; shift < 4; shift += 1) {
    bytes[16 + shift] = (width >>> (24 - shift * 8)) & 0xff;
    bytes[20 + shift] = (height >>> (24 - shift * 8)) & 0xff;
  }
  return bytes;
}

function jpegExifApp1(orientation: number): Uint8Array {
  const tiff = new Uint8Array(26);
  tiff.set([0x49, 0x49, 0x2a, 0x00], 0);
  tiff.set([0x08, 0x00, 0x00, 0x00], 4);
  tiff.set([0x01, 0x00], 8);
  tiff.set([0x12, 0x01, 0x03, 0x00], 10);
  tiff.set([0x01, 0x00, 0x00, 0x00], 14);
  tiff.set([orientation, 0x00, 0x00, 0x00], 18);
  tiff.set([0x00, 0x00, 0x00, 0x00], 22);

  const app1Length = 2 + 6 + tiff.length;
  const segment = new Uint8Array(2 + app1Length);
  segment.set([0xff, 0xe1, (app1Length >> 8) & 0xff, app1Length & 0xff], 0);
  segment.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 4);
  segment.set(tiff, 10);
  return segment;
}

function jpegWithExif(width: number, height: number, orientation: number): Uint8Array {
  const app1 = jpegExifApp1(orientation);
  const sof = new Uint8Array([
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
  const bytes = new Uint8Array(2 + app1.length + sof.length);
  bytes.set([0xff, 0xd8], 0);
  bytes.set(app1, 2);
  bytes.set(sof, 2 + app1.length);
  return bytes;
}

function makeFile(bytes: Uint8Array, size = bytes.length): DecodableFile {
  return {
    size,
    type: "image/png",
    slice(start = 0, end = size) {
      const from = Math.max(0, Math.min(bytes.length, start));
      const to = Math.max(from, Math.min(bytes.length, end));
      return {
        arrayBuffer: async () => bytes.slice(from, to).buffer as ArrayBuffer,
      };
    },
  };
}

interface FakeBitmap {
  width: number;
  height: number;
  closed: boolean;
  close(): void;
}

function fakeBitmap(width: number, height: number): FakeBitmap {
  return {
    width,
    height,
    closed: false,
    close() {
      this.closed = true;
    },
  };
}

function asBitmap(bitmap: FakeBitmap): ImageBitmap {
  return bitmap as unknown as ImageBitmap;
}

async function expectImportError(
  action: () => Promise<unknown>,
  code: string,
): Promise<ImageImportError> {
  try {
    await action();
  } catch (error) {
    expect(error).toBeInstanceOf(ImageImportError);
    expect((error as ImageImportError).code).toBe(code);
    return error as ImageImportError;
  }
  throw new Error(`expected ImageImportError(${code}), but no error was thrown`);
}

describe("decodeImageFile · 错误分支", () => {
  it("超过 20MB → FILE_TOO_LARGE，且不调用解码器", async () => {
    const createBitmap = vi.fn();
    await expectImportError(
      () =>
        decodeImageFile(makeFile(pngHeader(10, 10), MAX_IMAGE_FILE_BYTES + 1), { createBitmap }),
      "FILE_TOO_LARGE",
    );
    expect(createBitmap).not.toHaveBeenCalled();
  });

  it("伪造图片文本 → UNSUPPORTED_FORMAT，不调用解码器", async () => {
    const createBitmap = vi.fn();
    const bytes = new TextEncoder().encode("not an image at all");
    await expectImportError(
      () => decodeImageFile(makeFile(bytes), { createBitmap }),
      "UNSUPPORTED_FORMAT",
    );
    expect(createBitmap).not.toHaveBeenCalled();
  });

  it("文件头尺寸超限 → DIMENSION_LIMIT，解码前拒绝", async () => {
    const createBitmap = vi.fn();
    await expectImportError(
      () => decodeImageFile(makeFile(pngHeader(9000, 10)), { createBitmap }),
      "DIMENSION_LIMIT",
    );
    expect(createBitmap).not.toHaveBeenCalled();
  });

  it("损坏文件：两次解码都失败 → DECODE_FAILED（可恢复）", async () => {
    const createBitmap = vi.fn().mockRejectedValue(new Error("broken"));
    const error = await expectImportError(
      () => decodeImageFile(makeFile(pngHeader(32, 32)), { createBitmap }),
      "DECODE_FAILED",
    );
    expect(error.recoverable).toBe(true);
    expect(createBitmap).toHaveBeenCalledTimes(2);
  });

  it("方向无法纠正 → ORIENTATION_UNSUPPORTED，并关闭位图", async () => {
    const bitmap = fakeBitmap(100, 50);
    const createBitmap = vi.fn().mockResolvedValue(asBitmap(bitmap));
    const rotateBitmap = vi.fn().mockRejectedValue(new Error("no canvas"));
    await expectImportError(
      () =>
        decodeImageFile(makeFile(jpegWithExif(100, 50, 6)), {
          createBitmap,
          rotateBitmap,
        }),
      "ORIENTATION_UNSUPPORTED",
    );
    expect(bitmap.closed).toBe(true);
    expect(rotateBitmap).toHaveBeenCalledWith(asBitmap(bitmap), 6);
  });
});

describe("decodeImageFile · 成功与 EXIF 回退", () => {
  it("PNG 正常解码：返回真实位图尺寸与格式", async () => {
    const bitmap = fakeBitmap(640, 480);
    const createBitmap = vi.fn().mockResolvedValue(asBitmap(bitmap));
    const result = await decodeImageFile(makeFile(pngHeader(640, 480)), { createBitmap });
    expect(result.width).toBe(640);
    expect(result.height).toBe(480);
    expect(result.format).toBe("png");
    expect(result.orientationApplied).toBe(true);
    expect(result.warning).toBeNull();
  });

  it("带选项解码失败、无选项成功 → 回退并给出提示", async () => {
    const bitmap = fakeBitmap(32, 32);
    const createBitmap = vi
      .fn()
      .mockRejectedValueOnce(new Error("option unsupported"))
      .mockResolvedValueOnce(asBitmap(bitmap));
    const result = await decodeImageFile(makeFile(pngHeader(32, 32)), { createBitmap });
    expect(createBitmap).toHaveBeenCalledTimes(2);
    expect(result.orientationApplied).toBe(false);
    expect(result.warning).toContain("回退");
  });

  it("浏览器静默忽略 EXIF 6：检测到宽高未交换后手动纠正", async () => {
    const original = fakeBitmap(100, 50);
    const rotated = fakeBitmap(50, 100);
    const createBitmap = vi.fn().mockResolvedValue(asBitmap(original));
    const rotateBitmap = vi.fn().mockResolvedValue(asBitmap(rotated));
    const result = await decodeImageFile(makeFile(jpegWithExif(100, 50, 6)), {
      createBitmap,
      rotateBitmap,
    });
    expect(rotateBitmap).toHaveBeenCalledWith(asBitmap(original), 6);
    expect(result.width).toBe(50);
    expect(result.height).toBe(100);
    expect(result.orientationApplied).toBe(false);
    expect(result.warning).toContain("手动纠正");
  });

  it("解码后尺寸仍超限 → DIMENSION_LIMIT 并关闭位图", async () => {
    const bitmap = fakeBitmap(9000, 1);
    const createBitmap = vi.fn().mockResolvedValue(asBitmap(bitmap));
    // 文件头故意不含可解析尺寸，让解码后检查生效。
    const bytes = new Uint8Array(PNG_SIGNATURE);
    await expectImportError(
      () => decodeImageFile(makeFile(bytes), { createBitmap }),
      "DIMENSION_LIMIT",
    );
    expect(bitmap.closed).toBe(true);
  });
});
