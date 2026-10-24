import { useState } from "react";
import {
  PAGE_WARN_COUNT,
  downloadBytes,
  downloadText,
  exportCsv,
  exportPdf,
  exportPng,
  exportProjectJson,
  planMakeLayout,
  type PaperSizeName,
  type PngCellSize,
} from "../../export";
import { ExportError } from "../../export/errors";
import { useWorkspaceStore } from "../../state/workspace-store";

export function ExportPanel() {
  const pattern = useWorkspaceStore((state) => state.pattern);
  const setError = useWorkspaceStore((state) => state.setError);
  const [cellSize, setCellSize] = useState<PngCellSize>(16);
  const [paper, setPaper] = useState<PaperSizeName>("a4");
  const [overlap, setOverlap] = useState(2);
  const [showGrid, setShowGrid] = useState(true);
  const [showLegend, setShowLegend] = useState(true);
  const [showCoords, setShowCoords] = useState(true);
  const [showCodes, setShowCodes] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  if (!pattern) {
    return (
      <section className="control-section">
        <h3>导出</h3>
        <p className="hint">生成图纸后才能导出 PNG / PDF / CSV / JSON。</p>
      </section>
    );
  }

  const run = async (label: string, work: () => Promise<void> | void) => {
    setBusy(label);
    try {
      await work();
    } catch (error) {
      setError({
        code: error instanceof ExportError ? error.code : "E_EXPORT",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(null);
    }
  };

  const layout = planMakeLayout(pattern.width, pattern.height, paper, overlap);
  const pngCodes = showCodes && cellSize >= 16;

  return (
    <section className="control-section">
      <h3>导出</h3>
      <p className="hint">
        颜色只读取当前图纸色卡，不会重新量化。制作版 PDF {layout.rowPages}×{layout.colPages} 页（共{" "}
        {layout.slices.length} 页切片），格点 {layout.cellPt}pt。
      </p>
      {layout.slices.length > PAGE_WARN_COUNT && paper !== "a3" ? (
        <p className="hint">页数较多，可改用 A3 减少分页。</p>
      ) : null}
      <div className="field">
        <label htmlFor="png-cell">PNG 格尺寸</label>
        <select
          id="png-cell"
          value={cellSize}
          onChange={(event) => setCellSize(Number(event.target.value) as PngCellSize)}
        >
          <option value={8}>8px</option>
          <option value={16}>16px</option>
          <option value={24}>24px</option>
          <option value={32}>32px</option>
        </select>
      </div>
      <label>
        <input
          type="checkbox"
          checked={showGrid}
          onChange={(event) => setShowGrid(event.target.checked)}
        />
        网格
      </label>
      <label>
        <input
          type="checkbox"
          checked={showLegend}
          onChange={(event) => setShowLegend(event.target.checked)}
        />
        图例
      </label>
      <label>
        <input
          type="checkbox"
          checked={showCoords}
          onChange={(event) => setShowCoords(event.target.checked)}
        />
        四边坐标
      </label>
      <label>
        <input
          type="checkbox"
          checked={showCodes}
          onChange={(event) => setShowCodes(event.target.checked)}
        />
        每格色号（PNG 需 ≥16px）
      </label>
      <div className="field">
        <label htmlFor="pdf-paper">PDF 纸张</label>
        <select
          id="pdf-paper"
          value={paper}
          onChange={(event) => setPaper(event.target.value as PaperSizeName)}
        >
          <option value="a4">A4</option>
          <option value="a3">A3</option>
          <option value="letter">Letter</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="pdf-overlap">PDF 重叠格</label>
        <input
          id="pdf-overlap"
          type="number"
          min={0}
          max={4}
          value={overlap}
          onChange={(event) => setOverlap(Number(event.target.value))}
        />
      </div>
      <button
        type="button"
        className="btn btn--block"
        data-testid="export-png"
        disabled={busy !== null}
        onClick={() =>
          void run("png", () => {
            const bytes = exportPng(pattern, {
              cellSize,
              showGrid,
              showCoords,
              showCodes: pngCodes,
              showLegend,
            });
            downloadBytes(`${pattern.title || "pattern"}.png`, bytes, "image/png");
          })
        }
      >
        {busy === "png" ? "导出中…" : "导出 PNG"}
      </button>
      <button
        type="button"
        className="btn btn--block"
        data-testid="export-pdf-make"
        disabled={busy !== null}
        onClick={() =>
          void run("pdf-make", async () => {
            const result = await exportPdf(pattern, { paper, mode: "make", overlap, showCodes });
            downloadBytes(
              `${pattern.title || "pattern"}-make.pdf`,
              result.bytes,
              "application/pdf",
            );
          })
        }
      >
        {busy === "pdf-make" ? "导出中…" : "导出 PDF（制作版）"}
      </button>
      <button
        type="button"
        className="btn btn--block"
        data-testid="export-pdf-preview"
        disabled={busy !== null}
        onClick={() =>
          void run("pdf-preview", async () => {
            const result = await exportPdf(pattern, {
              paper,
              mode: "preview",
              overlap,
              showCodes: false,
            });
            downloadBytes(
              `${pattern.title || "pattern"}-preview.pdf`,
              result.bytes,
              "application/pdf",
            );
          })
        }
      >
        {busy === "pdf-preview" ? "导出中…" : "导出 PDF（预览版）"}
      </button>
      <button
        type="button"
        className="btn btn--block"
        data-testid="export-csv"
        disabled={busy !== null}
        onClick={() =>
          void run("csv", () => {
            downloadBytes(
              `${pattern.title || "pattern"}.csv`,
              exportCsv(pattern),
              "text/csv;charset=utf-8",
            );
          })
        }
      >
        导出 CSV
      </button>
      <button
        type="button"
        className="btn btn--block"
        data-testid="export-json"
        disabled={busy !== null}
        onClick={() =>
          void run("json", () => {
            downloadText(
              `${pattern.title || "pattern"}.json`,
              exportProjectJson(pattern),
              "application/json",
            );
          })
        }
      >
        导出 JSON
      </button>
    </section>
  );
}
