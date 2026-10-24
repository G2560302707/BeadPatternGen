import { useWorkspaceStore } from "../../state/workspace-store";

function suggestionText(
  width: number,
  isolated: number,
  fragments: number,
  thin: number,
  highDelta: number,
): string[] {
  const lines: string[] = [];
  if (width < 120 && (thin > 0 || isolated > 8)) {
    lines.push("细节低于单豆尺寸，建议把网格加到 120 宽以上，或换用更干净的裁剪。");
  }
  if (isolated > 0) {
    lines.push(
      `有 ${isolated} 颗孤立豆（四邻无同色）。拼装时这些点容易掉，可考虑加大网格或减少最大颜色数。`,
    );
  }
  if (fragments > 0) {
    lines.push(`有 ${fragments} 处不超过 2 颗的小碎片，手拼时容易漏。`);
  }
  if (thin > 0) {
    lines.push(`有 ${thin} 段细线游程（宽度不足 3 格），5mm 拼豆上很难成型。`);
  }
  if (highDelta > 0) {
    lines.push(`有 ${highDelta} 格与采样色差明显高于阈值，这是色卡离散化的结果，不是还原度评分。`);
  }
  if (lines.length === 0) {
    lines.push(
      "当前没有列出孤立豆、小碎片、细线或高色差格。仍建议放大图纸核对五官、文字和透明边界。",
    );
  }
  return lines;
}

export function QualityReport() {
  const diagnostic = useWorkspaceStore((state) => state.diagnostic);
  const pattern = useWorkspaceStore((state) => state.pattern);
  const highlightedCells = useWorkspaceStore((state) => state.highlightedCells);
  const setHighlightedCells = useWorkspaceStore((state) => state.setHighlightedCells);

  if (!diagnostic || !pattern) {
    return (
      <p className="hint">
        生成完成后，这里会列出孤立豆、小碎片、细线和明显色差格。不会给出百分比评分。
      </p>
    );
  }

  const same = (cells: number[]) =>
    highlightedCells !== null &&
    highlightedCells.length === cells.length &&
    highlightedCells.every((value, index) => value === cells[index]);

  const toggle = (cells: number[]) => {
    setHighlightedCells(same(cells) ? null : cells);
  };

  const fragmentCells = diagnostic.fragments.flatMap((item) => item.cells);
  const thinCells = diagnostic.thinRuns.map((item) => item.row * pattern.width + item.col);
  const suggestions = suggestionText(
    pattern.width,
    diagnostic.isolated.length,
    diagnostic.fragments.length,
    diagnostic.thinRuns.length,
    diagnostic.highDelta.length,
  );

  return (
    <section className="quality-report" data-testid="quality-report">
      <h3>质量诊断</h3>
      <ul className="quality-report__list">
        <li>
          <button
            type="button"
            className="btn btn--block"
            onClick={() => toggle(diagnostic.isolated)}
          >
            孤立豆 {diagnostic.isolated.length} 颗
          </button>
        </li>
        <li>
          <button type="button" className="btn btn--block" onClick={() => toggle(fragmentCells)}>
            小碎片 {diagnostic.fragments.length} 处
          </button>
        </li>
        <li>
          <button type="button" className="btn btn--block" onClick={() => toggle(thinCells)}>
            细线风险 {diagnostic.thinRuns.length} 段
          </button>
        </li>
        <li>
          <button
            type="button"
            className="btn btn--block"
            onClick={() => toggle(diagnostic.highDelta)}
          >
            高色差格 {diagnostic.highDelta.length} 格
          </button>
        </li>
      </ul>
      <p className="hint">点击一项可在画布上只读高亮对应格子，不会改图纸。</p>
      <ul className="quality-report__tips">
        {suggestions.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}
