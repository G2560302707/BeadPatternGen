import { describe, expect, it } from "vitest";
import { ImageImportError } from "../../core/image";
import {
  classifyImportError,
  isResolutionTooLow,
  nextImportPhase,
  phaseLabel,
} from "./import-classify";

describe("classifyImportError", () => {
  it("maps format / size / dimension codes to readable kinds", () => {
    expect(classifyImportError(new ImageImportError("UNSUPPORTED_FORMAT", "bad")).kind).toBe(
      "unsupported-format",
    );
    expect(classifyImportError(new ImageImportError("FILE_TOO_LARGE", "big")).title).toBe(
      "文件过大",
    );
    expect(classifyImportError(new ImageImportError("DIMENSION_LIMIT", "huge")).kind).toBe(
      "resolution-too-high",
    );
    expect(classifyImportError(new ImageImportError("EMPTY_FILE", "empty")).kind).toBe("empty");
    expect(classifyImportError(new ImageImportError("RESOLUTION_TOO_LOW", "tiny")).kind).toBe(
      "resolution-too-low",
    );
    expect(classifyImportError(new ImageImportError("DECODE_FAILED", "nope")).kind).toBe("decode");
  });

  it("does not swallow unknown errors as format issues", () => {
    const classified = classifyImportError(new Error("boom"));
    expect(classified.kind).toBe("unexpected");
    expect(classified.message).toBe("boom");
  });
});

describe("resolution floor", () => {
  it("rejects edges below 16px", () => {
    expect(isResolutionTooLow(8, 64)).toBe(true);
    expect(isResolutionTooLow(64, 64)).toBe(false);
  });
});

describe("import phase machine", () => {
  it("walks uploading → decoding → detecting on the happy path", () => {
    const uploading = nextImportPhase("idle", "start");
    expect(uploading).toBe("uploading");
    expect(phaseLabel(uploading)).toContain("上传");
    const decoding = nextImportPhase(uploading, "header-ok");
    expect(decoding).toBe("decoding");
    expect(phaseLabel(decoding)).toContain("解码");
    const detecting = nextImportPhase(decoding, "decoded");
    expect(detecting).toBe("detecting");
    expect(phaseLabel(detecting)).toContain("识别");
  });

  it("fails from any phase into error and reset returns idle", () => {
    expect(nextImportPhase("decoding", "fail")).toBe("error");
    expect(nextImportPhase("error", "reset")).toBe("idle");
  });
});
