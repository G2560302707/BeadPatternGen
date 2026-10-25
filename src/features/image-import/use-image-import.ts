import { useCallback } from "react";
import { FORMAT_LABEL } from "../../core/image";
import { imageIdFromBytes, importImage, mimeTypeForFormat } from "../../core/subject";
import { useWorkspaceStore } from "../../state/workspace-store";
import { computeAutoCrop } from "../image-crop/crop-math";
import { cancelSubjectDetection, restoreOrDetectSubjects } from "../subject-detect";
import { decodeImageFile } from "./decode-image";
import {
  classifyImportError,
  isResolutionTooLow,
  nextImportPhase,
  phaseLabel,
  resolutionTooLowMessage,
} from "./import-classify";

/**
 * 图片导入逻辑（从 ImageImportPanel 抽出，供导入页大拖放区与紧凑面板共用）：
 * 校验 → 解码（含 EXIF 纠正）→ 自动裁剪框 → 写入工作区 → 触发主体识别恢复。
 */
export function useImageImport() {
  const image = useWorkspaceStore((state) => state.image);
  const importPhase = useWorkspaceStore((state) => state.importPhase);
  const importError = useWorkspaceStore((state) => state.importError);

  const handleFile = useCallback(
    async (file: File) => {
      const store = useWorkspaceStore.getState();
      store.setImportError(null);
      store.setImportPhase(nextImportPhase("idle", "start"));
      try {
        await new Promise((resolve) => setTimeout(resolve, 0));
        store.setImportPhase(nextImportPhase("uploading", "header-ok"));
        const bytes = new Uint8Array(await file.arrayBuffer());
        const sourceImageId = await imageIdFromBytes(bytes);
        importImage({ imageBytes: bytes, fileName: file.name, createId: () => sourceImageId });
        const decoded = await decodeImageFile(file);
        if (isResolutionTooLow(decoded.width, decoded.height)) {
          decoded.bitmap.close();
          throw new Error(
            `RESOLUTION_TOO_LOW: ${resolutionTooLowMessage(decoded.width, decoded.height)}`,
          );
        }
        const state = useWorkspaceStore.getState();
        const crop = computeAutoCrop(decoded.width, decoded.height, state.gridW / state.gridH, state.fitMode);
        state.setImage(
          {
            ...decoded,
            fileName: file.name,
            formatLabel: FORMAT_LABEL[decoded.format],
            sourceImageId,
            ...(decoded.exifOrientation <= 1
              ? { sourceBytes: bytes, sourceMimeType: mimeTypeForFormat(decoded.format) }
              : {}),
          },
          crop,
        );
        restoreOrDetectSubjects();
      } catch (error) {
        useWorkspaceStore.getState().setImportError(classifyImportError(error));
      }
    },
    [],
  );

  const clearImage = useCallback(() => {
    cancelSubjectDetection();
    useWorkspaceStore.getState().clearImage();
  }, []);

  const dismissError = useCallback(() => {
    useWorkspaceStore.getState().setImportError(null);
  }, []);

  return {
    image,
    importPhase,
    importError,
    busy: importPhase === "uploading" || importPhase === "decoding",
    loading: phaseLabel(importPhase),
    handleFile,
    clearImage,
    dismissError,
  };
}

/** 加载内置示例图为 File（public/samples 下的同源资源）。 */
export async function loadSampleFile(name: string): Promise<File> {
  const response = await fetch(`${import.meta.env.BASE_URL}samples/${name}`);
  if (!response.ok) {
    throw new Error(`示例图加载失败：${name}`);
  }
  const blob = await response.blob();
  return new File([blob], name, { type: "image/png" });
}
