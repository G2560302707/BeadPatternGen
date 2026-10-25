import { PatternError, computeStats } from "../../core/pattern";
import { importPatternJson } from "../../storage/project-repository";
import { StorageError } from "../../storage/errors";
import { useWorkspaceStore } from "../../state/workspace-store";

/** 读取并导入工程 JSON；成功后图纸进入工作区。错误统一转成中文可见错误。 */
export async function importPatternFile(file: File): Promise<void> {
  const store = useWorkspaceStore.getState();
  try {
    const text = await file.text();
    const pattern = importPatternJson(text);
    store.loadPattern(pattern, computeStats(pattern), false);
  } catch (error) {
    const message =
      error instanceof StorageError || error instanceof PatternError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    const code =
      error instanceof StorageError || error instanceof PatternError ? error.code : "E_IMPORT";
    store.setError({ code, message });
  }
}
