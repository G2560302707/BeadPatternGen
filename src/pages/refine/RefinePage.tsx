import { useWorkspaceStore } from "../../state/workspace-store";
import { PatternBoard } from "../../features/pattern-preview/PatternBoard";
import { PalettePanel } from "../../features/palette-panel/PalettePanel";
import { GatePlaceholder, StepIntro, StepNav } from "../../ui/StepIntro";

/** S5 精修：全功能画布（画笔/橡皮/吸色/选区/撤销/锁格）+ 右栏用色统计与诊断。 */
export default function RefinePage() {
  const pattern = useWorkspaceStore((s) => s.pattern);
  const sample = useWorkspaceStore((s) => s.sample);

  if (!pattern) {
    return (
      <div className="page">
        <GatePlaceholder
          title="精修台是空的"
          body={sample ? "先去调色生成一张图纸，回来就能逐格精修。" : "先导入图片、采样并生成图纸，才有得精修。"}
          action={{ to: sample ? "/make/generate" : "/make/import", label: sample ? "去生成图纸" : "去导入图片" }}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <StepIntro
        emoji="🖌️"
        title="逐格精修"
        sub="吸色联动同色高亮，框选后可填充/镜像/平移；右侧色卡点一下就能当画笔。改过的格子会自动锁定。"
        mood="happy"
      />
      <div className="page-grid page-grid--refine">
        <section
          className="canvas-board canvas-board--pattern"
          aria-label="图纸预览"
          data-testid="pattern-board"
          data-pattern-id={pattern.id}
        >
          <PatternBoard pattern={pattern} />
        </section>
        <PalettePanel />
      </div>
      <StepNav
        prev={{ to: "/make/generate", label: "上一步，调色生成" }}
        next={{ to: "/make/export", label: "下一步，导出分享", testId: "next-export" }}
      />
    </div>
  );
}
