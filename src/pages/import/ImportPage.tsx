import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ErrorNotice } from "../../components/ErrorNotice";
import { LoadingNotice } from "../../components/LoadingNotice";
import { PrivacyNotice } from "../../features/privacy/PrivacyNotice";
import { loadSampleFile, useImageImport } from "../../features/image-import/use-image-import";
import { StepIntro, StepNav } from "../../ui/StepIntro";

const SAMPLES = [
  { file: "heart.png", label: "爱心" },
  { file: "star.png", label: "星星" },
  { file: "strawberry.png", label: "草莓" },
  { file: "sunset.png", label: "日落风景" },
] as const;

/** S1 导入：大拖放区 + 内置示例 + 隐私承诺。导入成功自动进入构图步。 */
export default function ImportPage() {
  const navigate = useNavigate();
  const { image, importPhase, importError, busy, loading, handleFile, dismissError } =
    useImageImport();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // 导入成功 → 自动进入下一步（构图，可跳过）
  useEffect(() => {
    if (image) navigate("/make/compose");
  }, [image, navigate]);

  // 支持直接粘贴剪贴板里的图片
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const file = Array.from(event.clipboardData?.files ?? [])[0];
      if (file && file.type.startsWith("image/")) {
        event.preventDefault();
        void handleFile(file);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [handleFile]);

  if (image) {
    // 理论上会被上方 effect 立刻带走；保留一帧的过渡展示
    return (
      <div className="page">
        <StepIntro emoji="📷" title="导入成功" sub="正在带你去抠图构图…" mood="happy" />
      </div>
    );
  }

  return (
    <div className="page">
      <StepIntro
        emoji="📷"
        title="先选一张喜欢的图"
        sub="支持 JPG / PNG / WebP，单文件 ≤ 20MB。图片只在你电脑里处理，绝不上传。"
      />

      {importError ? (
        <div data-testid="import-error" data-kind={importError.kind}>
          <ErrorNotice
            code={`${importError.title} · ${importError.code}`}
            message={importError.message}
            onDismiss={dismissError}
          />
        </div>
      ) : null}
      {loading ? (
        <div data-testid="import-phase" data-phase={importPhase}>
          <LoadingNotice label={loading} />
        </div>
      ) : null}

      <label
        className={`import-drop${dragOver ? " import-drop--over" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          const file = event.dataTransfer.files[0];
          if (file) void handleFile(file);
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
            if (file) void handleFile(file);
            event.target.value = "";
          }}
        />
        <span className="import-drop__emoji" aria-hidden="true">
          🖼️
        </span>
        <span className="import-drop__main">把图片拖进来，或点击选择</span>
        <span className="import-drop__hint">也可以直接 Ctrl + V 粘贴截图</span>
      </label>

      <section className="control-section">
        <h3>没有图？先用示例玩一把</h3>
        <div className="sample-gallery" data-testid="sample-gallery">
          {SAMPLES.map((sample) => (
            <button
              key={sample.file}
              type="button"
              className="sample-thumb"
              data-testid={`sample-${sample.file.replace(".png", "")}`}
              disabled={busy}
              onClick={() => {
                void loadSampleFile(sample.file).then((file) => handleFile(file));
              }}
            >
              <img src={`${import.meta.env.BASE_URL}samples/${sample.file}`} alt={sample.label} />
              <span>{sample.label}</span>
            </button>
          ))}
        </div>
      </section>

      <PrivacyNotice />

      <StepNav next={{ to: "/make/compose", label: "下一步，去抠图", testId: "next-compose" }} />
    </div>
  );
}
