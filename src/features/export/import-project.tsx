import { useRef, useState } from "react";
import { importPatternFile } from "./import-pattern";

export function ImportProjectButton() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (file: File) => {
    setBusy(true);
    try {
      await importPatternFile(file);
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
