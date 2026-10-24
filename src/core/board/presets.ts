/**
 * 市售拼豆板规格与成品尺寸换算。
 *
 * 口径（2026-10 核对市售商品）：
 * - 5mm 标准豆：方板 29×29 钉、钉距 5mm，是全网最主流标准板；58×58 为 2×2 拼接。
 * - 2.6mm 迷你豆：小板 26×26 钉、钉距约 2.8mm；市售 52 钉大板 = 2×2 小板，
 *   78 钉 = 3×3。图纸常见规格 52×52 / 78×78 即由此而来。
 * 外形尺寸含边框卡扣，比钉区大 1.5–2.5cm，本模块只按钉区换算成品尺寸。
 */

export type BoardBeadSize = "2.6mm" | "5mm";

export interface BoardPreset {
  /** 宽（格）。 */
  width: number;
  /** 高（格）。 */
  height: number;
  /** 展示名，如 "52×52"。 */
  label: string;
  /** 市售口径说明，如 "1 块大板（= 2×2 小板）"。 */
  boardLabel: string;
  /** 占用小板总数（5mm 即板数）。 */
  boards: number;
}

export interface BoardSpec {
  beadSize: BoardBeadSize;
  /** 单块基准板的边长钉数（2.6mm 为小板 26，5mm 为标准板 29）。 */
  unitGrid: number;
  /** 钉距（毫米），用于成品尺寸换算。 */
  pitchMm: number;
  /** 规格说明（UI 展示）。 */
  note: string;
  presets: BoardPreset[];
}

function squarePresets(
  unitGrid: number,
  multiples: Array<{ n: number; boardLabel: string }>,
): BoardPreset[] {
  return multiples.map(({ n, boardLabel }) => {
    const size = unitGrid * n;
    return {
      width: size,
      height: size,
      label: `${size}×${size}`,
      boardLabel,
      boards: n * n,
    };
  });
}

export const BOARD_SPECS: Record<BoardBeadSize, BoardSpec> = {
  "5mm": {
    beadSize: "5mm",
    unitGrid: 29,
    pitchMm: 5,
    note: "标准大豆 · 方板 29×29 钉 · 钉距 5mm",
    presets: squarePresets(29, [
      { n: 1, boardLabel: "1 块板" },
      { n: 2, boardLabel: "2×2 拼接 4 块板" },
      { n: 3, boardLabel: "3×3 拼接 9 块板" },
    ]),
  },
  "2.6mm": {
    beadSize: "2.6mm",
    unitGrid: 26,
    pitchMm: 2.8,
    note: "迷你小豆 · 小板 26×26 钉 · 钉距约 2.8mm",
    presets: squarePresets(26, [
      { n: 1, boardLabel: "1 块小板" },
      { n: 2, boardLabel: "1 块 52 钉大板（= 2×2 小板）" },
      { n: 3, boardLabel: "1 块 78 钉板（= 3×3 小板）" },
      { n: 4, boardLabel: "4 块 52 钉大板（= 4×4 小板）" },
    ]),
  },
};

/** 板数按整板向上取整：非整板尺寸会多占边缘钉位。 */
export function boardCount(beadSize: BoardBeadSize, width: number, height: number): number {
  const { unitGrid } = BOARD_SPECS[beadSize];
  const cols = Math.max(1, Math.ceil(width / unitGrid));
  const rows = Math.max(1, Math.ceil(height / unitGrid));
  return cols * rows;
}

export function boardCountLabel(
  beadSize: BoardBeadSize,
  width: number,
  height: number,
): string {
  const { unitGrid } = BOARD_SPECS[beadSize];
  const cols = Math.max(1, Math.ceil(width / unitGrid));
  const rows = Math.max(1, Math.ceil(height / unitGrid));
  const total = cols * rows;
  if (total === 1) return "1 块板";
  return `${cols}×${rows} 拼接 ${total} 块板`;
}

/** 熨烫后成品尺寸（厘米，保留 1 位小数）。豆子熔合后会略缩，此为钉距名义值。 */
export function finishedSizeCm(
  beadSize: BoardBeadSize,
  width: number,
  height: number,
): { widthCm: number; heightCm: number } {
  const { pitchMm } = BOARD_SPECS[beadSize];
  const round = (grids: number) => Math.round((grids * pitchMm) / 10 * 10) / 10;
  return { widthCm: round(width), heightCm: round(height) };
}

export function finishedSizeLabel(
  beadSize: BoardBeadSize,
  width: number,
  height: number,
): string {
  const size = finishedSizeCm(beadSize, width, height);
  const widthText = size.widthCm.toFixed(1).replace(/\.0$/, "");
  const heightText = size.heightCm.toFixed(1).replace(/\.0$/, "");
  return `成品约 ${widthText}×${heightText} cm`;
}
