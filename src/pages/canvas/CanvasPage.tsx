import { useWorkspaceStore } from "../../state/workspace-store";
import { CropControls } from "../../features/image-crop/CropControls";
import { SampleControls } from "../../features/generation-settings/SampleControls";
import { PatternPreview } from "../../features/pattern-preview/PatternPreview";
import { GatePlaceholder, SidePanel, StepIntro, StepNav } from "../../ui/StepIntro";

/** S3 画布与裁剪：裁剪 + 格数 + 板子预设 + 透明策略，右侧实时预览。 */
export default function CanvasPage() {
  const image = useWorkspaceStore((s) => s.image);
  const sample = useWorkspaceStore((s) => s.sample);
  const pattern = useWorkspaceStore((s) => s.pattern);

  if (!image) {
    return (
      <div className="page">
        <GatePlaceholder
          title="画布还没有内容"
          body="先去导入一张图片，这里才能裁剪并决定图纸有多少格。"
          action={{ to: "/make/import", label: "去导入图片" }}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <StepIntro
        emoji="📐"
        title="决定图纸有多大"
        sub="一颗豆 = 一格。左边裁剪、定格数（可用市售板子预设），点「应用裁剪并采样」后去调色。"
      />
      <div className="page-grid">
        <SidePanel title="裁剪与画布">
          <CropControls />
          <SampleControls />
        </SidePanel>
        <PatternPreview />
      </div>
      <StepNav
        prev={{ to: "/make/compose", label: "上一步，抠图构图" }}
        next={{
          to: "/make/generate",
          label: "下一步，去调色生成",
          testId: "next-generate",
          disabled: !sample,
          hint: sample
            ? pattern
              ? "已有图纸：重新采样会基于新参数重新生成。"
              : undefined
            : "先点上方「应用裁剪并采样」。",
        }}
      />
    </div>
  );
}
