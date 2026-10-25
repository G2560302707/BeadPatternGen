import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { GenerateControls } from "../../features/generation-settings/GenerateControls";
import { useWorkspaceStore } from "../../state/workspace-store";
import { GatePlaceholder, SidePanel, StepIntro } from "../../ui/StepIntro";

/** S4 调色生成：画风卡片 + 颜色数 + 高级选项；生成完成自动进入精修。 */
export default function GeneratePage() {
  const navigate = useNavigate();
  const image = useWorkspaceStore((s) => s.image);
  const sample = useWorkspaceStore((s) => s.sample);
  const pattern = useWorkspaceStore((s) => s.pattern);
  const generation = useWorkspaceStore((s) => s.generation);

  // 生成完成 → 去精修
  useEffect(() => {
    if (generation.status === "done" && pattern) {
      navigate("/make/refine");
    }
  }, [generation.status, pattern, navigate]);

  if (!image) {
    return (
      <div className="page">
        <GatePlaceholder
          title="还不需要调色呢"
          body="这里会把图片的颜色匹配到真实色卡。先去导入图片并完成画布采样。"
          action={{ to: "/make/import", label: "去导入图片" }}
        />
      </div>
    );
  }

  if (!sample) {
    return (
      <div className="page">
        <GatePlaceholder
          title="先完成画布采样"
          body="调色之前要确定图纸的格数并完成采样，去画布步点「应用裁剪并采样」。"
          action={{ to: "/make/canvas", label: "去画布裁剪" }}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <StepIntro
        emoji="🎨"
        title="挑个画风，一键生成"
        sub="四种画风对应不同的优化策略；拿不准就选二次元（插画）或照片（实拍），默认参数即推荐值。"
        mood="working"
      />
      <div className="page-grid">
        <SidePanel title="生成设置">
          <GenerateControls />
        </SidePanel>
        <section className="canvas-board" aria-label="采样预览提示">
          <div className="empty-state">
            <span style={{ fontSize: 44 }} aria-hidden="true">
              ⏳
            </span>
            <p className="empty-state__title">生成进行中</p>
            <p className="empty-state__body">
              六个阶段：采样 → 选色 → 匹配 → 抖动 → 优化 → 诊断。左下角有进度条，随时可以取消。
              生成完成后会自动带你进入精修画布。
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
