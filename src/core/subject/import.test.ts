import { describe, expect, it } from "vitest";
import { ImageImportError } from "../image";
import { imageIdFromBytes, importImage, mimeTypeForFormat } from "./import";

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

function expectImportError(code: string, action: () => unknown): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ImageImportError);
    expect((error as ImageImportError).code).toBe(code);
    return;
  }
  throw new Error(`expected ImageImportError(${code}), but no error was thrown`);
}

describe("importImage", () => {
  it("returns the detected format, header dimensions and a stable imageId", () => {
    const result = importImage({
      imageBytes: pngHeader(64, 48),
      fileName: "photo.png",
      createId: () => "image-1",
    });

    expect(result).toEqual({
      imageId: "image-1",
      format: "png",
      dimensions: { width: 64, height: 48 },
      byteLength: 33,
    });
  });

  it("generates a random imageId when none is injected", () => {
    const first = importImage({ imageBytes: pngHeader(32, 32) });
    const second = importImage({ imageBytes: pngHeader(32, 32) });

    expect(first.imageId).not.toBe("");
    expect(second.imageId).not.toBe(first.imageId);
  });

  it("rejects short-edge images below 16px", () => {
    expectImportError("RESOLUTION_TOO_LOW", () => importImage({ imageBytes: pngHeader(8, 8) }));
  });

  it("hashes identical bytes to the same imageId", async () => {
    const bytes = pngHeader(64, 48);
    const first = await imageIdFromBytes(bytes);
    const second = await imageIdFromBytes(new Uint8Array(bytes));
    expect(first).toMatch(/^img-[0-9a-f]{64}$/);
    expect(second).toBe(first);
  });

  it("maps format to a Worker mime type", () => {
    expect(mimeTypeForFormat("png")).toBe("image/png");
    expect(mimeTypeForFormat("jpeg")).toBe("image/jpeg");
    expect(mimeTypeForFormat("webp")).toBe("image/webp");
  });

  it("rejects empty bytes before reading the header", () => {
    expectImportError("EMPTY_FILE", () => importImage({ imageBytes: new Uint8Array() }));
  });

  it("rejects a non-image payload", () => {
    const bytes = new Uint8Array(64).fill(0x41);
    expectImportError("UNSUPPORTED_FORMAT", () => importImage({ imageBytes: bytes }));
  });

  it("rejects dimensions beyond the hard limit", () => {
    expectImportError("DIMENSION_LIMIT", () =>
      importImage({ imageBytes: pngHeader(9000, 10) }),
    );
  });

  it("tolerates a truncated header and reports null dimensions", () => {
    // 只有魔数：无法读尺寸，但文件仍可交给解码器判断。
    const result = importImage({ imageBytes: new Uint8Array(PNG_SIGNATURE) });

    expect(result.format).toBe("png");
    expect(result.dimensions).toBeNull();
  });
});
