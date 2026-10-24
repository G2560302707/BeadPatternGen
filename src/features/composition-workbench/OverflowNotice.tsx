import { computeCompositionPlan } from "../../core/composition";
import { useWorkspaceStore } from "../../state/workspace-store";
import { inferPositionPreset } from "./layout";
import { describeOverflow } from "./overflow-hint";

export function OverflowNotice() {
  const image = useWorkspaceStore((state) => state.image);
  const candidates = useWorkspaceStore((state) => state.subjectCandidates);
  const selectedId = useWorkspaceStore((state) => state.selectedSubjectId);
  const params = useWorkspaceStore((state) => state.compositionParams);
  const patchCompositionParams = useWorkspaceStore((state) => state.patchCompositionParams);
  const setCompositionPosition = useWorkspaceStore((state) => state.setCompositionPosition);

  const candidate = candidates.find((item) => item.id === selectedId) ?? candidates[0] ?? null;
  if (!image || !candidate) return null;

  let plan;
  try {
    plan = computeCompositionPlan(image.width, image.height, candidate.bbox, params);
  } catch {
    return null;
  }
  const message = describeOverflow(plan);
  if (!message) return null;
  const suggestion = plan.suggestion;

  const same =
    Math.abs(suggestion.offsetX - params.offsetX) < 1e-6 &&
    Math.abs(suggestion.offsetY - params.offsetY) < 1e-6;

  return (
    <div className="inline-warning" role="status" data-testid="overflow-warning">
      <p>{message}</p>
      <button
        type="button"
        className="btn btn--small"
        data-testid="apply-overflow-suggestion"
        disabled={same}
        onClick={() => {
          patchCompositionParams({ offsetX: suggestion.offsetX, offsetY: suggestion.offsetY });
          setCompositionPosition(inferPositionPreset(suggestion.offsetX, suggestion.offsetY));
        }}
      >
        采纳建议位置
      </button>
    </div>
  );
}
