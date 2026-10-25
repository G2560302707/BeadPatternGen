import { useState } from "react";
import {
  PAGE_WARN_COUNT,
  downloadBytes,
  downloadText,
  exportCsv,
  exportPdf,
  exportPng,
  exportProjectJson,
  exportShareCardPng,
  exportSvg,
  planMakeLayout,
  type PaperSizeName,
  type PngCellSize,
} from "../../export";
import { ExportError } from "../../export/errors";
import { useWorkspaceStore } from "../../state/workspace-store";
import { celebrate } from "../../ui/confetti";

export function ExportPanel() {
  const pattern = useWorkspaceStore((state) => state.pattern);
  const setError = useWorkspaceStore((state) => state.setError);
  const image = useWorkspaceStore((state) => state.image);
  const [cellSize, setCellSize] = useState<PngCellSize>(16);
  const [paper, setPaper] = useState<PaperSizeName>("a4");
  const [overlap, setOverlap] = useState(2);
  const [fitSinglePage, setFitSinglePage] = useState(true);
  const [includeLegend, setIncludeLegend] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showLegend, setShowLegend] = useState(true);
  const [showCoords, setShowCoords] = useState(true);
  const [showCodes, setShowCodes] = useState(true);
  const [shareScale, setShareScale] = useState<1 | 2>(1);
  const [shareCompare, setShareCompare] = useState(true);
  const [watermark, setWatermark] = useState("");
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
      celebrate();
    } catch (error) {
      setError({
        code: error instanceof ExportError ? error.code : "E_EXPORT",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(null);
    }
  };

  const layout = planMakeLayout(pattern.width, pattern.height, paper, overlap, fitSinglePage);
  const pngCodes = showCodes && cellSize >= 16;
  const singlePageLayout = fitSinglePage && layout.slices.length === 1 && !Number.isInteger(layout.cellPt);
  const layoutHint = singlePageLayout
    ? `制作版 PDF 整图缩放进 1 页 · 格点 ${layout.cellPt.toFixed(2)}pt（约 ${((layout.cellPt * 25.4) / 72).toFixed(1)}mm）· 矢量输出，放大不失真`
    : `制作版 PDF ${layout.rowPages}×${layout.colPages} 页（共 ${layout.slices.length} 页切片），格点 ${layout.cellPt}pt`;

  return (
    <section className="control-section">
      <h3>导出</h3>
      <p className="hint">
        颜色只读取当前图纸色卡，不会重新量化。{layoutHint}
        {includeLegend ? "，另加色表页" : ""}
        {singlePageLayout && layout.cellPt < 5 ? "。格子较小，建议改用 A3 或关闭单页缩放。" : "。"}
      </p>
      {layout.slices.length > PAGE_WARN_COUNT && paper !== "a3" ? (
        <p className="hint">页数较多，可改用 A3 减少分页。</p>
      ) : null}
      <p className="hint">
        所有导出共用同一套「分享卡片」版式：页眉信息栏 + 白色圆角图纸卡（红角标、每 5
        格分区线）+ 按用量排序的色卡图例 + 脚注。
      </p>
      <div className="field">
        <label htmlFor="png-cell">图纸 PNG 格尺寸</label>
        <select
          id="png-cell"
          value={cellSize}
          onChange={(event) => setCellSize(Number(event.target.value) as PngCellSize)}
        >
          <option value={8}>8px</option>
          <option value={16}>16px</option>
          <option value={24}>24px</option>
          <option value={32}>32px</option>
          <option value={48}>48px（超清）</option>
          <option value={64}>64px（超清）</option>
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
        行列号（每 5 格）
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
      <label title="超出单页容量时用小数格点把整图缩放进一页（矢量，不失真）；关闭则按重叠格切片分页">
        <input
          type="checkbox"
          data-testid="pdf-fit-single-page"
          checked={fitSinglePage}
          onChange={(event) => setFitSinglePage(event.target.checked)}
        />
        整图缩放到单页
      </label>
      <label title="在图纸后追加颜色清单页（色号、数量）；不影响图纸本体">
        <input
          type="checkbox"
          data-testid="pdf-include-legend"
          checked={includeLegend}
          onChange={(event) => setIncludeLegend(event.target.checked)}
        />
        包含色表页
      </label>
      <p className="hint">
        分享图纸：仿市面社交卡片版式（信息栏 + 图纸 + 用量图例 + 原图/烫后对比）。
        {image ? "" : "未导入图片时省略原图对比。"}
      </p>
      <div className="field">
        <label htmlFor="share-scale">分享图清晰度</label>
        <select
          id="share-scale"
          value={shareScale}
          onChange={(event) => setShareScale(Number(event.target.value) as 1 | 2)}
        >
          <option value={1}>标准（宽 1242px）</option>
          <option value={2}>高清 2x（宽 2484px）</option>
        </select>
      </div>
      <label>
        <input
          type="checkbox"
          checked={shareCompare}
          onChange={(event) => setShareCompare(event.target.checked)}
        />
        底部原图 / 烫后对比
      </label>
      <div className="field field--inline">
        <label htmlFor="share-watermark">水印</label>
        <input
          id="share-watermark"
          type="text"
          maxLength={24}
          placeholder="可留空"
          value={watermark}
          onChange={(event) => setWatermark(event.target.value)}
        />
      </div>
      <button
        type="button"
        className="btn btn--primary btn--block"
        data-testid="export-share-card"
        disabled={busy !== null}
        onClick={() =>
          void run("share", async () => {
            const source =
              shareCompare && image
                ? { image: image.bitmap, width: image.width, height: image.height, crop: pattern.source.crop ?? null }
                : null;
            const bytes = await exportShareCardPng(pattern, {
              scale: shareScale,
              showCompare: shareCompare,
              source,
              watermark,
            });
            downloadBytes(
              `${pattern.title || "pattern"}-share.png`,
              bytes,
              "image/png",
            );
          })
        }
      >
        {busy === "share" ? "导出中…" : "导出分享图纸 PNG"}
      </button>
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
        data-testid="export-svg"
        title="矢量图：任意缩放不失真，行列号 / 网格线 / 色号全部保留"
        disabled={busy !== null}
        onClick={() =>
          void run("svg", () => {
            const svg = exportSvg(pattern, {
              cellSize,
              showGrid,
              showCoords,
              showCodes: pngCodes,
              showLegend,
            });
            downloadText(`${pattern.title || "pattern"}.svg`, svg, "image/svg+xml");
          })
        }
      >
        {busy === "svg" ? "导出中…" : "导出 SVG（矢量，放大不失真）"}
      </button>
      <button
        type="button"
        className="btn btn--block"
        data-testid="export-pdf-make"
        disabled={busy !== null}
        onClick={() =>
          void run("pdf-make", async () => {
            const result = await exportPdf(pattern, {
              paper,
              mode: "make",
              overlap,
              showCodes,
              fitSinglePage,
              includeLegend,
            });
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
