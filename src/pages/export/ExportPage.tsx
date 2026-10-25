import { useWorkspaceStore } from "../../state/workspace-store";
import { ExportPanel } from "../../features/export/ExportPanel";
import { SaveControls } from "../../features/export/SaveControls";
import { GatePlaceholder, SidePanel, StepIntro, StepNav } from "../../ui/StepIntro";

/** S6 导出分享：五种导出 + 保存作品库。 */
export default function ExportPage() {
  const pattern = useWorkspaceStore((s) => s.pattern);

  if (!pattern) {
    return (
      <div className="page">
        <GatePlaceholder
          title="还没有可以带走的图纸"
          body="生成图纸后，这里可以导出分享图、制作 PDF、采购清单和工程文件。"
          action={{ to: "/make/import", label: "去制作图纸" }}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <StepIntro
        emoji="🎁"
        title="把图纸带走"
        sub="分享图 PNG 直接发社交平台；制作 PDF 照着拼；采购 CSV 拿去买豆；JSON 可随时回来继续改。"
        mood="happy"
      />
      <div className="page-grid">
        <SidePanel title="导出文件">
          <ExportPanel />
        </SidePanel>
        <div className="page" style={{ gap: 16 }}>
          <SaveControls />
          <section className="control-section">
            <h3>分享小贴士</h3>
            <p className="hint">
              「分享图纸 PNG」自带信息栏与色卡图例，直接发到社交平台即可；勾选水印能让更多人找到这个工具。
              重要图纸记得「保存到本机」并导出 JSON 备份——清除浏览器数据会删掉本地项目。
            </p>
          </section>
        </div>
      </div>
      <StepNav prev={{ to: "/make/refine", label: "上一步，精修" }} />
    </div>
  );
}
