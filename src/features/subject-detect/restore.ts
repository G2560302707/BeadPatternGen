import type { SubjectCandidate, SubjectWithMask } from "../../core/subject";
import { useWorkspaceStore } from "../../state/workspace-store";
import type { ImageSession } from "../../state/workspace-store";
import { loadSubjectsWithMasksForImage } from "../../workers/subject-service";

export function subjectToCandidate(subject: SubjectWithMask): SubjectCandidate {
  return {
    id: subject.id,
    sourceImageId: subject.sourceImageId,
    mask: subject.mask,
    bbox: subject.bbox,
    confidence: subject.confidence,
    label: subject.label,
    createdAt: subject.createdAt,
  };
}

/** 同一张原图（内容哈希 id）若已有落库主体且蒙版尺寸匹配，则跳过分割。 */
export async function tryRestoreSubjects(image: ImageSession): Promise<boolean> {
  if (!image.sourceImageId) return false;
  const loaded = await loadSubjectsWithMasksForImage(image.sourceImageId);
  const matches = loaded.filter(
    (item) => item.mask.width === image.width && item.mask.height === image.height,
  );
  if (matches.length === 0) return false;
  useWorkspaceStore.getState().setSubjectCandidates(matches.map(subjectToCandidate));
  useWorkspaceStore.getState().setImportPhase("ready");
  return true;
}
