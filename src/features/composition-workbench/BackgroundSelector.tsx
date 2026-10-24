import { useRef } from "react";
import { useWorkspaceStore } from "../../state/workspace-store";
import type { RgbaImage } from "../../core/composition";
import { decodeImageFile } from "../image-import/decode-image";
import {
  BACKGROUND_PRESET_CODES,
  backgroundPatch,
  backgroundPresets,
  DEFAULT_SOLID_HEX,
  normalizeHex,
} from "./background-presets";

export function BackgroundSelector() {
  const params = useWorkspaceStore((state) => state.compositionParams);
  const patchCompositionParams = useWorkspaceStore((state) => state.patchCompositionParams);
  const setCompositionBackgroundImage = useWorkspaceStore(
    (state) => state.setCompositionBackgroundImage,
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const presets = backgroundPresets();
  const solidHex =
    params.backgroundType === "solid"
      ? (params.backgroundValue ?? DEFAULT_SOLID_HEX)
      : DEFAULT_SOLID_HEX;

  return (
    <section className="control-section" data-testid="background-selector">
      <h3>背景</h3>
      <div className="preset-row">
        <button
          type="button"
          className={
            params.backgroundType === "transparent"
              ? "btn btn--small btn--primary"
              : "btn btn--small"
          }
          data-testid="bg-transparent"
          onClick={() => {
            setCompositionBackgroundImage(null);
            patchCompositionParams(backgroundPatch("transparent", null));
          }}
        >
          透明
        </button>
        <button
          type="button"
          className={
            params.backgroundType === "solid" ? "btn btn--small btn--primary" : "btn btn--small"
          }
          data-testid="bg-solid"
          onClick={() => {
            setCompositionBackgroundImage(null);
            patchCompositionParams(backgroundPatch("solid", solidHex));
          }}
        >
          纯色
        </button>
        <button
          type="button"
          className={
            params.backgroundType === "image" ? "btn btn--small btn--primary" : "btn btn--small"
          }
          data-testid="bg-image"
          onClick={() => fileRef.current?.click()}
        >
          自定义图片
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
          data-testid="bg-image-file"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            void (async () => {
              const decoded = await decodeImageFile(file);
              try {
                const canvas = document.createElement("canvas");
                canvas.width = decoded.width;
                canvas.height = decoded.height;
                const ctx = canvas.getContext("2d");
                if (!ctx) return;
                ctx.drawImage(decoded.bitmap, 0, 0);
                const pixels = ctx.getImageData(0, 0, decoded.width, decoded.height);
                const image: RgbaImage = {
                  width: decoded.width,
                  height: decoded.height,
                  data: new Uint8ClampedArray(pixels.data),
                };
                setCompositionBackgroundImage(image);
                patchCompositionParams({
                  backgroundType: "image",
                  backgroundValue: file.name,
                });
              } finally {
                decoded.bitmap.close();
              }
            })();
          }}
        />
      </div>

      {params.backgroundType === "solid" ? (
        <>
          <div className="preset-row bg-swatch-row">
            {presets.map((color) => (
              <button
                key={color.code}
                type="button"
                className={
                  solidHex.toUpperCase() === color.hex.toUpperCase()
                    ? "bg-swatch bg-swatch--active"
                    : "bg-swatch"
                }
                data-testid={`bg-swatch-${color.code}`}
                title={`${color.code} ${color.name}`}
                aria-label={`${color.code} ${color.name}`}
                style={{ background: color.hex }}
                onClick={() => patchCompositionParams(backgroundPatch("solid", color.hex))}
              />
            ))}
          </div>
          <div className="field field--inline">
            <label htmlFor="bg-custom">自定义</label>
            <input
              id="bg-custom"
              type="color"
              data-testid="bg-custom"
              value={solidHex}
              onChange={(event) => {
                const hex = normalizeHex(event.target.value);
                if (hex) patchCompositionParams(backgroundPatch("solid", hex));
              }}
            />
            <code>{solidHex}</code>
          </div>
        </>
      ) : (
        <p className="hint">透明区域用棋盘格表示，不会画成黑色。</p>
      )}

      {params.backgroundType === "image" ? (
        <p className="hint" data-testid="bg-image-placeholder">
          已使用自定义背景图{params.backgroundValue ? `：${params.backgroundValue}` : ""}。按 cover 铺满画布。
        </p>
      ) : null}

      <p className="hint">
        锁定主体后切换背景，不会改占比与位置。常用色来自 {BACKGROUND_PRESET_CODES.join(" / ")}。
      </p>
    </section>
  );
}
