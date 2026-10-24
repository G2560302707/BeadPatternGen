import { EmptyState } from "../../components/EmptyState";
import { QualityReport } from "../quality-report/QualityReport";
import {
  paletteColors,
  paletteColorsByDefinitionId,
  paletteEntry,
  paletteEntryByDefinitionId,
} from "./locked-palette";
import { useWorkspaceStore } from "../../state/workspace-store";

export function PalettePanel() {
  const paletteOpen = useWorkspaceStore((s) => s.paletteOpen);
  const togglePalette = useWorkspaceStore((s) => s.togglePalette);
  const stats = useWorkspaceStore((s) => s.stats);
  const pattern = useWorkspaceStore((s) => s.pattern);
  const highlightedColorIndex = useWorkspaceStore((s) => s.highlightedColorIndex);
  const setHighlightedColorIndex = useWorkspaceStore((s) => s.setHighlightedColorIndex);
  const setPaintColorIndex = useWorkspaceStore((s) => s.setPaintColorIndex);
  const storePaletteId = useWorkspaceStore((s) => s.paletteId);

  const used = stats?.byColor.filter((row) => row.count > 0) ?? [];

  return (
    <aside className="panel panel--right">
      <header className="panel__head">
        <h2>色卡与用量</h2>
      </header>
      {pattern && stats ? (
        <div className="palette-usage" data-testid="palette-stats">
          <p className="palette-list__meta">
            {stats.beadCount} 颗 · {stats.colorCount} 色 · 点击色号选为画笔颜色并高亮
          </p>
          <ul>
            {used.map((row) => {
              const paletteIndex = pattern.palette.findIndex((color) => color.code === row.code);
              const active = highlightedColorIndex === paletteIndex;
              return (
                <li key={row.code}>
                  <button
                    type="button"
                    className={`usage-row${active ? " usage-row--active" : ""}`}
                    onClick={() => {
                      if (paletteIndex >= 0) {
                        setPaintColorIndex(paletteIndex);
                      }
                      setHighlightedColorIndex(active || paletteIndex < 0 ? null : paletteIndex);
                    }}
                  >
                    <span className="swatch" style={{ background: row.hex }} />
                    <code>{row.code}</code>
                    <span>{row.name}</span>
                    <span>
                      {row.count} · {row.percentage.toFixed(1)}%
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <EmptyState
          title="还没有图纸"
          body="生成之后会在这里列出每色颗数。现在只能查看已锁定的真实色卡，不会出现假统计。"
        />
      )}
      <QualityReport />
      <button type="button" className="btn btn--block" onClick={togglePalette}>
        {paletteOpen ? "收起已锁定色卡" : "查看已锁定色卡"}
      </button>
      {paletteOpen ? (
        <div className="palette-list">
          {(() => {
            // 图纸自带色卡按定义 id 反查；无图纸时展示当前选中的生成色卡。
            const locked = pattern
              ? paletteEntryByDefinitionId(pattern.paletteId)
              : paletteEntry(storePaletteId);
            const lockedColors = pattern
              ? paletteColorsByDefinitionId(pattern.paletteId)
              : paletteColors(storePaletteId);
            return (
              <>
                <p className="palette-list__meta">
                  {locked.label} · {locked.definition.brand} · {locked.definition.series} ·{" "}
                  {locked.definition.version} · {lockedColors.length} 色
                </p>
                <ul>
                  {lockedColors.map((color) => (
                    <li key={color.code}>
                      <span className="swatch" style={{ background: color.hex }} />
                      <code>{color.code}</code>
                      <span>{color.name}</span>
                    </li>
                  ))}
                </ul>
              </>
            );
          })()}
        </div>
      ) : null}
    </aside>
  );
}
