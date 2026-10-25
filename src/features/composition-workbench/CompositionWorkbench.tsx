import { ImageImportPanel } from "../image-import/ImageImportPanel";
import { SubjectPanel } from "../subject-panel/SubjectPanel";
import { cancelSubjectDetection, detectSubjects } from "../subject-detect";
import { useWorkspaceStore } from "../../state/workspace-store";
import { CompositionCanvas } from "./CompositionCanvas";
import { CompositionParamsPanel } from "./CompositionParamsPanel";
import { confirmComposition } from "./confirm-compose";

interface CompositionWorkbenchProps {
  /** 新版分页流程：跳过时回调（默认行为：留在本页并切回 classic 模式）。 */
  onSkip?: () => void;
  /** 新版分页流程：确认构图成功后回调（生成已自动开始）。 */
  onConfirm?: () => void;
}

export function CompositionWorkbench({ onSkip, onConfirm }: CompositionWorkbenchProps) {
  const candidates = useWorkspaceStore((state) => state.subjectCandidates);
  const progress = useWorkspaceStore((state) => state.subjectProgress);
  const setWorkbenchMode = useWorkspaceStore((state) => state.setWorkbenchMode);
  const setImportPhase = useWorkspaceStore((state) => state.setImportPhase);
  const canConfirm = candidates.length > 0 && progress.status === "success";

  const skipCompose = () => {
    cancelSubjectDetection();
    setImportPhase("ready");
    setWorkbenchMode("classic");
    onSkip?.();
  };

  return (
    <div className="compose-shell" data-testid="composition-workbench">
      <div className="workbench__body workbench__body--compose">
        <aside className="panel panel--left">
          <header className="panel__head">
            <h2>原图与主体</h2>
          </header>
          <ImageImportPanel />
          <SubjectPanel />
        </aside>
        <section className="canvas-board" aria-label="构图预览">
          <CompositionCanvas />
        </section>
        <CompositionParamsPanel />
      </div>
      <div className="compose-bar">
        <button type="button" className="btn" data-testid="skip-compose" onClick={skipCompose}>
          上一步 / 跳过构图
        </button>
        <button
          type="button"
          className="btn"
          data-testid="redetect-subject-bar"
          disabled={progress.status === "running"}
          onClick={() => detectSubjects()}
        >
          重新识别
        </button>
        <button
          type="button"
          className="btn btn--primary"
          data-testid="confirm-compose"
          disabled={!canConfirm}
          onClick={() => {
            void confirmComposition().then(() => onConfirm?.());
          }}
        >
          确认生成
        </button>
      </div>
    </div>
  );
}
