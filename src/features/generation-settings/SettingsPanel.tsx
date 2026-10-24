import { useWorkspaceStore } from "../../state/workspace-store";
import { CropControls } from "../image-crop/CropControls";
import { ImageImportPanel } from "../image-import/ImageImportPanel";
import { ExportPanel } from "../export/ExportPanel";
import { SaveControls } from "../export/SaveControls";
import { PrivacyNotice } from "../privacy/PrivacyNotice";
import { GenerateControls } from "./GenerateControls";
import { SampleControls } from "./SampleControls";

export function SettingsPanel() {
  const image = useWorkspaceStore((state) => state.image);

  return (
    <aside className="panel panel--left">
      <header className="panel__head">
        <h2>图片与参数</h2>
      </header>
      <ImageImportPanel />
      {image ? (
        <>
          <CropControls />
          <SampleControls />
          <GenerateControls />
        </>
      ) : (
        <p className="hint">
          导入图片后才能裁剪与采样。生成图纸后可用画笔、橡皮和取色精修。
        </p>
      )}
      <ExportPanel />
      <SaveControls />
      <PrivacyNotice />
    </aside>
  );
}
