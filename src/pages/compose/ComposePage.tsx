import { useNavigate } from "react-router-dom";
import { CompositionWorkbench } from "../../features/composition-workbench/CompositionWorkbench";
import { useWorkspaceStore } from "../../state/workspace-store";
import { GatePlaceholder, StepIntro } from "../../ui/StepIntro";

/** S2 抠图构图（可选步）：完整复用二期构图工作台，接上新流程导航。 */
export default function ComposePage() {
  const navigate = useNavigate();
  const image = useWorkspaceStore((s) => s.image);

  if (!image) {
    return (
      <div className="page">
        <GatePlaceholder
          title="这一步需要一张图片"
          body="先去导入一张图，回来就能一键抠出主体、摆上 C 位。这一步是可选的，不抠图也能继续。"
          action={{ to: "/make/import", label: "去导入图片" }}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <StepIntro
        emoji="✂️"
        title="让主角站上 C 位（可选）"
        sub="一键识别主体，可手涂蒙版修补，再选背景和占比。只想要整张图？直接点下方「跳过」。"
        mood="working"
      />
      <CompositionWorkbench
        onSkip={() => navigate("/make/canvas")}
        onConfirm={() => navigate("/make/generate")}
      />
    </div>
  );
}
