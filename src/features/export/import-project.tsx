import { useRef, useState } from "react";
import { PatternError, computeStats } from "../../core/pattern";
import { importPatternJson } from "../../storage/project-repository";
import { StorageError } from "../../storage/errors";
import { useWorkspaceStore } from "../../state/workspace-store";

export function ImportProjectButton() {
  const inputRef = useRef<HTMLInputElement>(null);
  const loadPattern = useWorkspaceStore((state) => state.loadPattern);
  const setError = useWorkspaceStore((state) => state.setError);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File) => {
    const snapshot = useWorkspaceStore.getState().pattern;
    setBusy(true);
    try {
      const text = await file.text();
      const pattern = importPatternJson(text);
      loadPattern(pattern, computeStats(pattern), false);
    } catch (error) {
      if (useWorkspaceStore.getState().pattern !== snapshot) {
        // 失败不得改变工作区：若已写入则这是编程错误。
      }
      const message =
        error instanceof StorageError || error instanceof PatternError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      const code =
        error instanceof StorageError || error instanceof PatternError ? error.code : "E_IMPORT";
      setError({ code, message });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        hidden
        data-testid="import-json"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void onFile(file);
        }}
      />
      <button
        type="button"
        className="btn btn--small"
        disabled={busy}
        data-testid="import-json-button"
        onClick={() => inputRef.current?.click()}
      >
        导入 JSON
      </button>
    </>
  );
}
