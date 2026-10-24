import type { BeadPattern } from "../core/pattern";
import { assertExportReady } from "./assert";

const BOM = "\uFEFF";

function csvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

export function exportCsv(pattern: BeadPattern): Uint8Array {
  const stats = assertExportReady(pattern);
  const lines = ["色号,色名,HEX,数量,占比"];
  let roundedSum = 0;
  const used = stats.byColor.filter((row) => row.count > 0);
  for (const row of used) {
    const pct = Math.round(row.percentage * 100) / 100;
    roundedSum += pct;
    lines.push(
      [
        csvField(row.code),
        csvField(row.name),
        csvField(row.hex),
        String(row.count),
        pct.toFixed(2),
      ].join(","),
    );
  }
  const diff = Math.round((100 - roundedSum) * 100) / 100;
  const totalPct = diff === 0 ? "100.00" : `舍入差 ${diff > 0 ? "+" : ""}${diff.toFixed(2)}`;
  lines.push(["合计", "", "", String(stats.beadCount), totalPct].join(","));
  const text = BOM + lines.join("\r\n") + "\r\n";
  return new TextEncoder().encode(text);
}
