import { useRef } from "react";
import { ErrorNotice } from "../../components/ErrorNotice";
import { LoadingNotice } from "../../components/LoadingNotice";
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

export function ImageImportPanel() {
  const image = useWorkspaceStore((state) => state.image);
  const importPhase = useWorkspaceStore((state) => state.importPhase);
  const importError = useWorkspaceStore((state) => state.importError);
  const setImage = useWorkspaceStore((state) => state.setImage);
  const clearImage = useWorkspaceStore((state) => state.clearImage);
  const setImportPhase = useWorkspaceStore((state) => state.setImportPhase);
  const setImportError = useWorkspaceStore((state) => state.setImportError);
  const gridW = useWorkspaceStore((state) => state.gridW);
  const gridH = useWorkspaceStore((state) => state.gridH);
  const fitMode = useWorkspaceStore((state) => state.fitMode);

  const inputRef = useRef<HTMLInputElement>(null);
  const busy = importPhase === "uploading" || importPhase === "decoding";

  const handleFile = async (file: File) => {
    setImportError(null);
    setImportPhase(nextImportPhase("idle", "start"));
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      setImportPhase(nextImportPhase("uploading", "header-ok"));
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
      const crop = computeAutoCrop(decoded.width, decoded.height, gridW / gridH, fitMode);
      setImage(
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
      setImportError(classifyImportError(error));
    } finally {
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  };

  const loading = phaseLabel(importPhase);

  return (
    <section className="control-section">
      <h3>图片输入</h3>
      <label
        className="file-drop"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const file = event.dataTransfer.files[0];
          if (file) {
            void handleFile(file);
          }
        }}
      >
        <input
          ref={inputRef}
          type="file"
          data-testid="import-file"
          accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void handleFile(file);
            }
          }}
        />
        <span>{image ? "更换图片" : "选择图片 / 拖入这里"}</span>
      </label>
      <p className="hint">JPG / PNG / WebP · ≤ 20MB · 单边 16–8192px · 总像素 ≤ 4000 万</p>

      {loading ? (
        <div data-testid="import-phase" data-phase={importPhase}>
          <LoadingNotice label={loading} />
        </div>
      ) : null}

      {importError ? (
        <div data-testid="import-error" data-kind={importError.kind}>
          <ErrorNotice
            code={`${importError.title} · ${importError.code}`}
            message={importError.message}
            onDismiss={() => setImportError(null)}
          />
          <button
            type="button"
            className="btn btn--small"
            onClick={() => inputRef.current?.click()}
          >
            重新选择
          </button>
        </div>
      ) : null}

      {image ? (
        <div className="image-meta">
          <p className="image-meta__name" title={image.fileName}>
            {image.fileName}
          </p>
          <p>
            {image.formatLabel} · {image.width}×{image.height}px · EXIF orientation{" "}
            {image.exifOrientation}
          </p>
          {image.warning ? (
            <p className="inline-warning" role="status">
              {image.warning}
            </p>
          ) : null}
          <button
            type="button"
            className="btn btn--small"
            onClick={() => {
              cancelSubjectDetection();
              clearImage();
            }}
          >
            移除图片
          </button>
        </div>
      ) : null}
    </section>
  );
}
