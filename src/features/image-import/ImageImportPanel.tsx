import { useRef } from "react";
import { ErrorNotice } from "../../components/ErrorNotice";
import { LoadingNotice } from "../../components/LoadingNotice";
import { useImageImport } from "./use-image-import";

/** 紧凑导入面板（构图工作台左栏复用）；导入页的大拖放区走 ImportPage 自己的布局。 */
export function ImageImportPanel() {
  const { image, importPhase, importError, busy, loading, handleFile, clearImage, dismissError } =
    useImageImport();
  const inputRef = useRef<HTMLInputElement>(null);

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
            onDismiss={dismissError}
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
          <button type="button" className="btn btn--small" onClick={clearImage}>
            移除图片
          </button>
        </div>
      ) : null}
    </section>
  );
}
