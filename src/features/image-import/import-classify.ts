/**
 * K1 · 导入预检错误归类与状态机（纯 UI 层，不改 core）。
 */

import { ImageImportError, MIN_IMAGE_DIMENSION } from "../../core/image";

/** 与 core `MIN_IMAGE_DIMENSION` 对齐，UI 文案与预检共用。 */
export const MIN_IMPORT_EDGE = MIN_IMAGE_DIMENSION;

export type ImportPhase = "idle" | "uploading" | "decoding" | "detecting" | "ready" | "error";

export type ImportErrorKind =
  | "unsupported-format"
  | "file-too-large"
  | "resolution-too-low"
  | "resolution-too-high"
  | "corrupt"
  | "decode"
  | "empty"
  | "unexpected";

export interface ClassifiedImportError {
  kind: ImportErrorKind;
  code: string;
  title: string;
  message: string;
}

const KIND_TITLE: Record<ImportErrorKind, string> = {
  "unsupported-format": "格式不支持",
  "file-too-large": "文件过大",
  "resolution-too-low": "分辨率过低",
  "resolution-too-high": "分辨率过高",
  corrupt: "文件损坏",
  decode: "解码失败",
  empty: "文件无效",
  unexpected: "导入失败",
};

export function titleForKind(kind: ImportErrorKind): string {
  return KIND_TITLE[kind];
}

export function classifyImportError(error: unknown): ClassifiedImportError {
  if (error instanceof ImageImportError) {
    const kind = kindFromCode(error.code);
    return {
      kind,
      code: error.code,
      title: KIND_TITLE[kind],
      message: error.message,
    };
  }
  if (error instanceof Error && error.message.includes("RESOLUTION_TOO_LOW")) {
    return {
      kind: "resolution-too-low",
      code: "RESOLUTION_TOO_LOW",
      title: KIND_TITLE["resolution-too-low"],
      message: error.message.replace(/^RESOLUTION_TOO_LOW:\s*/, ""),
    };
  }
  return {
    kind: "unexpected",
    code: "E_UNEXPECTED",
    title: KIND_TITLE.unexpected,
    message: error instanceof Error ? error.message : String(error),
  };
}

function kindFromCode(code: string): ImportErrorKind {
  switch (code) {
    case "UNSUPPORTED_FORMAT":
      return "unsupported-format";
    case "FILE_TOO_LARGE":
      return "file-too-large";
    case "EMPTY_FILE":
      return "empty";
    case "DIMENSION_LIMIT":
      return "resolution-too-high";
    case "CORRUPT_HEADER":
      return "corrupt";
    case "DECODE_FAILED":
    case "ORIENTATION_UNSUPPORTED":
      return "decode";
    case "RESOLUTION_TOO_LOW":
      return "resolution-too-low";
    default:
      return "unexpected";
  }
}

export function resolutionTooLowMessage(width: number, height: number): string {
  return `图片 ${width}×${height}px 短边低于 ${MIN_IMPORT_EDGE}px，主体识别与拼豆网格都无法使用。请换一张更大的图。`;
}

export function isResolutionTooLow(width: number, height: number): boolean {
  return width < MIN_IMPORT_EDGE || height < MIN_IMPORT_EDGE;
}

export function phaseLabel(phase: ImportPhase): string | null {
  switch (phase) {
    case "uploading":
      return "上传中…";
    case "decoding":
      return "解码中…";
    case "detecting":
      return "正在识别主体…";
    default:
      return null;
  }
}

export function nextImportPhase(
  current: ImportPhase,
  event: "start" | "header-ok" | "decoded" | "fail" | "reset",
): ImportPhase {
  if (event === "reset") return "idle";
  if (event === "fail") return "error";
  if (event === "start") return "uploading";
  if (event === "header-ok" && (current === "uploading" || current === "idle")) return "decoding";
  if (event === "decoded" && (current === "decoding" || current === "uploading"))
    return "detecting";
  return current;
}
