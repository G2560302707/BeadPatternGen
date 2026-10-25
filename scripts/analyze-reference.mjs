/* global createImageBitmap, document, ImageData */
/**
 * 参考图纸反提取分析（probe 模式）：
 *
 *   node scripts/analyze-reference.mjs [--dir 参考图集/图纸] [--out 参考图集/分析]
 *        [--only 关键字] [--probe 文件名1,文件名2,...]
 *
 * --probe：对指定图纸做「格子尺寸扫描」——豆图纸的本质特征是每格近似纯色，
 * 对候选 cell 尺寸计算格内颜色方差，方差谷即真实豆格尺寸；然后按检测到的
 * 网格逐格取中位色映射 MARD 221，输出统计 + 网格叠加预览（人工目检确认）。
 * 不带 --probe 时走全自动网格线检测（对规整扫描件有效）。
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 4190;

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const dir = path.resolve(root, argValue("--dir", "参考图集/图纸"));
const outDir = path.resolve(root, argValue("--out", "参考图集/分析"));
const probeList = argValue("--probe", null);
const only = argValue("--only", null);

await mkdir(path.join(outDir, "probe"), { recursive: true });
let files = (await readdir(dir))
  .filter((name) => /\.(jpe?g|png|webp)$/i.test(name))
  .filter((name) => (only ? name.includes(only) : true))
  .sort();
if (probeList) {
  const wanted = probeList.split(",").map((s) => s.trim());
  files = files.filter((name) => wanted.some((w) => name.startsWith(w)));
}

const server = await createServer({
  root,
  logLevel: "silent",
  server: { host: "127.0.0.1", port, strictPort: true },
});
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });

await page.evaluate(async () => {
  const { paletteColors } = await import("/src/features/palette-panel/locked-palette.ts");
  const { deltaE2000, rgbToLab, hexToRgb } = await import("/src/core/color/index.ts");
  globalThis.__mard = paletteColors("mard-221").map((color) => ({
    code: color.code,
    lab: rgbToLab(hexToRgb(color.hex)),
  }));
  globalThis.__mapNearest = (r, g, b) => {
    const lab = rgbToLab({ r, g, b });
    let best = null;
    let bestD = Infinity;
    for (const color of globalThis.__mard) {
      const d = deltaE2000(lab, color.lab);
      if (d < bestD) {
        bestD = d;
        best = color.code;
      }
    }
    return { code: best, delta: bestD };
  };
});

async function loadImage(imagePath) {
  const bytes = new Uint8Array(await readFile(imagePath));
  return page.evaluate(async (base64) => {
    const blob = await (await fetch(`data:application/octet-stream;base64,${base64}`)).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return { imageData: { data: Array.from(imageData.data), width: bitmap.width, height: bitmap.height } };
  }, Buffer.from(bytes).toString("base64"));
}

async function probeOne(imagePath, name) {
  const img = await loadImage(imagePath);
  return page.evaluate(({ img, name }) => {
    globalThis.__img = img;
    /* eslint-disable no-undef */
    const px = img.imageData.data;
    const W = img.imageData.width;
    const H = img.imageData.height;
    const medianOf = (arr) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
    const edge = Math.max(4, Math.floor(Math.min(W, H) * 0.02));
    const er = [], eg = [], eb = [];
    for (let y = 0; y < H; y += Math.max(1, Math.floor(H / 150))) {
      for (let x = 0; x < edge; x += 1) {
        const o = (y * W + x) * 4;
        const o2 = (y * W + (W - 1 - x)) * 4;
        er.push(px[o], px[o2]); eg.push(px[o + 1], px[o2 + 1]); eb.push(px[o + 2], px[o2 + 2]);
      }
    }
    const bg = { r: medianOf(er), g: medianOf(eg), b: medianOf(eb) };
    const isBg = (x, y) => {
      const o = (y * W + x) * 4;
      return Math.abs(px[o] - bg.r) + Math.abs(px[o + 1] - bg.g) + Math.abs(px[o + 2] - bg.b) < 60;
    };
    const colFill = new Uint8Array(W);
    const rowFill = new Uint8Array(H);
    for (let x = 0; x < W; x += 1) {
      let n = 0;
      for (let y = 0; y < H; y += 2) if (!isBg(x, y)) n += 1;
      colFill[x] = n > (H / 2) * 0.02 ? 1 : 0;
    }
    for (let y = 0; y < H; y += 1) {
      let n = 0;
      for (let x = 0; x < W; x += 2) if (!isBg(x, y)) n += 1;
      rowFill[y] = n > (W / 2) * 0.02 ? 1 : 0;
    }
    const firstIdx = (a) => { for (let i = 0; i < a.length; i += 1) if (a[i]) return i; return -1; };
    const lastIdx = (a) => { for (let i = a.length - 1; i >= 0; i -= 1) if (a[i]) return i; return -1; };
    let bx0 = Math.max(0, firstIdx(colFill));
    let bx1 = Math.min(W - 1, lastIdx(colFill));
    // 行方向取最大连续填充带：砍掉底部色号图例/顶部标注行（与主体间有空隙）
    let bestBand = null;
    let runStart = -1;
    for (let y = 0; y <= H; y += 1) {
      const on = y < H && rowFill[y] === 1;
      if (on && runStart < 0) runStart = y;
      if (!on && runStart >= 0) {
        if (!bestBand || y - runStart > bestBand[1] - bestBand[0]) bestBand = [runStart, y - 1];
        runStart = -1;
      }
    }
    const by0 = bestBand ? bestBand[0] : Math.max(0, firstIdx(rowFill));
    const by1 = bestBand ? bestBand[1] : Math.min(H - 1, lastIdx(rowFill));
    if (bx1 - bx0 < 60 || by1 - by0 < 60) return { file: name, ok: false, reason: `图案区过小 ${bx1 - bx0}x${by1 - by0}` };
    const spread = (rgbs) => {
      const mr = medianOf(rgbs.map((c) => c[0]));
      const mg = medianOf(rgbs.map((c) => c[1]));
      const mb = medianOf(rgbs.map((c) => c[2]));
      let worst = 0;
      for (const [r, g, b] of rgbs) worst = Math.max(worst, Math.abs(r - mr) + Math.abs(g - mg) + Math.abs(b - mb));
      return worst;
    };
    // ── cell 扫描（bbox 内），方差谷 = 真实豆格尺寸 ──
    const scores = [];
    for (let cell = 8; cell <= 56; cell += 1) {
      const cols = Math.max(4, Math.round((bx1 - bx0) / cell));
      const rows = Math.max(4, Math.round((by1 - by0) / cell));
      const cw = (bx1 - bx0) / cols;
      const ch = (by1 - by0) / rows;
      let sum = 0;
      let n = 0;
      const step = Math.max(1, Math.floor(Math.min(cols, rows) / 40));
      for (let ry = 0; ry < rows; ry += step) {
        for (let cx = 0; cx < cols; cx += step) {
          const pts = [];
          for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]]) {
            const x = Math.min(W - 1, Math.max(0, Math.round(bx0 + cx * cw + cw * fx)));
            const y = Math.min(H - 1, Math.max(0, Math.round(by0 + ry * ch + ch * fy)));
            const o = (y * W + x) * 4;
            pts.push([px[o], px[o + 1], px[o + 2]]);
          }
          sum += spread(pts);
          n += 1;
        }
      }
      scores.push({ cell, score: n > 0 ? sum / n : Infinity, cols, rows });
    }
    scores.sort((a, b) => a.score - b.score);
    const top = scores.slice(0, 3);
    // ── 对最优 cell 微调 origin（±cell/2 内 5x5）──
    const best = top[0];
    let bestOrigin = { ox: 0, oy: 0, score: Infinity };
    for (let fx = -2; fx <= 2; fx += 1) {
      for (let fy = -2; fy <= 2; fy += 1) {
        const ox = fx * best.cell * 0.25;
        const oy = fy * best.cell * 0.25;
        let sum = 0;
        let n = 0;
        for (let ry = 0; ry < best.rows; ry += 2) {
          for (let cx = 0; cx < best.cols; cx += 2) {
            const x0 = bx0 + ox + cx * best.cell;
            const y0 = by0 + oy + ry * best.cell;
            if (x0 < 0 || y0 < 0 || x0 + best.cell > W || y0 + best.cell > H) continue;
            const pts = [];
            for (const [pfx, pfy] of [[0.5, 0.5], [0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]]) {
              const x = Math.min(W - 1, Math.max(0, Math.round(x0 + best.cell * pfx)));
              const y = Math.min(H - 1, Math.max(0, Math.round(y0 + best.cell * pfy)));
              const o = (y * W + x) * 4;
              pts.push([px[o], px[o + 1], px[o + 2]]);
            }
            sum += spread(pts);
            n += 1;
          }
        }
        const score = n > 0 ? sum / n : Infinity;
        if (score < bestOrigin.score) bestOrigin = { ox, oy, score };
      }
    }
    // ── 重建图纸 + 叠加预览 ──
    const { cols, rows, cell } = best;
    const ox = bx0 + bestOrigin.ox;
    const oy = by0 + bestOrigin.oy;
    const cellColors = [];
    for (let ry = 0; ry < rows; ry += 1) {
      for (let cx = 0; cx < cols; cx += 1) {
        // 每格 9 点采样：图纸格心印有色号文字，会污染单点颜色。
        // 每点独立映射 MARD 色号后取众数——文字点占少数，众数即豆底色。
        const pts = [];
        const votes = {};
        const rgb = { r: 0, g: 0, b: 0 };
        for (const [pfx, pfy] of [
          [0.3, 0.3], [0.5, 0.3], [0.7, 0.3],
          [0.3, 0.5], [0.5, 0.5], [0.7, 0.5],
          [0.3, 0.7], [0.5, 0.7], [0.7, 0.7],
        ]) {
          const x = Math.min(W - 1, Math.max(0, Math.round(ox + (cx + pfx) * cell)));
          const y = Math.min(H - 1, Math.max(0, Math.round(oy + (ry + pfy) * cell)));
          const o = (y * W + x) * 4;
          const rgb = [px[o], px[o + 1], px[o + 2]];
          pts.push(rgb);
          const mapped = __mapNearest(rgb[0], rgb[1], rgb[2]);
          votes[mapped.code] = (votes[mapped.code] ?? 0) + 1;
        }
        const voteEntries = Object.entries(votes).sort((a, b) => b[1] - a[1]);
        const code = voteEntries[0][0];
        const consensus = voteEntries[0][1] / pts.length;
        rgb.r = medianOf(pts.map((c) => c[0]));
        rgb.g = medianOf(pts.map((c) => c[1]));
        rgb.b = medianOf(pts.map((c) => c[2]));
        // 共识度低于 50% = 色号文字污染（投票分散），该格不可信，按空格处理
        if (consensus < 0.5) {
          cellColors.push({ ...rgb, code: null, delta: 0, consensus });
          continue;
        }
        const mapped = __mapNearest(rgb.r, rgb.g, rgb.b);
        cellColors.push({ ...rgb, code, delta: Math.round(mapped.delta * 10) / 10, consensus });
      }
    }
    const hist = {};
    for (const c of cellColors) {
      if (c.code === null) continue;
      hist[c.code] = (hist[c.code] ?? 0) + 1;
    }
    const sorted = Object.entries(hist).sort((a, b) => b[1] - a[1]);
    const total = cellColors.length;
    const whiteCodes = new Set(["H1", "H2", "H18", "H12"]);
    const whiteCount = sorted.filter(([code]) => whiteCodes.has(code)).reduce((s, [, n]) => s + n, 0);
    const isWhite = (code) => whiteCodes.has(code);
    const seen = new Uint8Array(total);
    let filled = 0;
    let singletons = 0;
    let consensusSum = 0;
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const i = y * cols + x;
        const cell2 = cellColors[i];
        if (!cell2 || cell2.code === null || isWhite(cell2.code) || seen[i]) continue;
        filled += 1;
        consensusSum += cell2.consensus;
        const queue = [[x, y]];
        seen[i] = 1;
        let size = 0;
        while (queue.length) {
          const [qx, qy] = queue.pop();
          size += 1;
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const nx = qx + dx;
            const ny = qy + dy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            const ni = ny * cols + nx;
            const nc = cellColors[ni];
            if (!nc || nc.code === null || isWhite(nc.code) || seen[ni] || nc.code !== cell2.code) continue;
            seen[ni] = 1;
            queue.push([nx, ny]);
          }
        }
        if (size === 1) singletons += 1;
      }
    }
    const singletonRatio = filled > 0 ? Math.round((singletons / filled) * 1000) / 10 : null;
    const deltas = cellColors.map((c) => c.delta).sort((a, b) => a - b);
    const meanMapDelta = Math.round((deltas.reduce((a, b) => a + b, 0) / deltas.length) * 10) / 10;
    // ── 渲染：叠加预览 + 重建图纸 ──
    const mkCanvas = (w, h) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      return c;
    };
    const overlay = mkCanvas(W, H);
    const octx = overlay.getContext("2d");
    octx.putImageData(new ImageData(new Uint8ClampedArray(px), W, H), 0, 0);
    octx.strokeStyle = "rgba(255,0,0,0.55)";
    octx.lineWidth = 1;
    octx.strokeRect(ox, oy, cols * cell, rows * cell);
    octx.beginPath();
    for (let cx = 0; cx <= cols; cx += 1) {
      octx.moveTo(Math.round(ox + cx * cell) + 0.5, oy);
      octx.lineTo(Math.round(ox + cx * cell) + 0.5, oy + rows * cell);
    }
    for (let ry = 0; ry <= rows; ry += 1) {
      octx.moveTo(ox, Math.round(oy + ry * cell) + 0.5);
      octx.lineTo(ox + cols * cell, Math.round(oy + ry * cell) + 0.5);
    }
    octx.stroke();
    const cellPx = Math.max(3, Math.floor(420 / Math.max(cols, rows)));
    const rebuilt = mkCanvas(cols * cellPx, rows * cellPx);
    const rctx = rebuilt.getContext("2d");
    rctx.fillStyle = "#ffffff";
    rctx.fillRect(0, 0, rebuilt.width, rebuilt.height);
    for (let ry = 0; ry < rows; ry += 1) {
      for (let cx = 0; cx < cols; cx += 1) {
        const c2 = cellColors[ry * cols + cx];
        if (!c2 || c2.code === null) continue;
        rctx.fillStyle = `rgb(${c2.r},${c2.g},${c2.b})`;
        rctx.fillRect(cx * cellPx, ry * cellPx, cellPx - 1, cellPx - 1);
      }
    }
    return {
      file: name,
      ok: true,
      bbox: [bx0, by0, bx1, by1],
      cell,
      cols,
      rows,
      originScore: Math.round(bestOrigin.score),
      grid: `${cols}x${rows}`,
      longSide: Math.max(cols, rows),
      cellCount: total,
      usedColors: sorted.length,
      whiteRatio: Math.round((whiteCount / total) * 1000) / 10,
      singletonRatio,
      meanCellSpread: filled > 0 ? Math.round((consensusSum / filled) * 100) : null,
      meanMapDelta,
      topCodes: sorted.slice(0, 12).map(([code, n]) => [code, Math.round((n / total) * 1000) / 10]),
      cellColors,
      overlayPng: overlay.toDataURL("image/png"),
      rebuiltPng: rebuilt.toDataURL("image/png"),
    };
    /* eslint-enable no-undef */
  }, { img, name });
}

const results = [];
for (const [i, file] of files.entries()) {
  process.stdout.write(`[${i + 1}/${files.length}] ${file} ... `);
  try {
    const r = await probeOne(path.join(dir, file), file.replace(/\.[^.]+$/, ""));
    if (r.ok) {
      console.log(`cell=${r.cell}px ${r.grid} · ${r.usedColors} 色 · 白格 ${r.whiteRatio}% · 孤立豆 ${r.singletonRatio}% · ΔE ${r.meanMapDelta} · 格内差 ${r.meanCellSpread}`);
      await writeFile(path.join(outDir, "probe", `${r.file}-overlay.png`), Buffer.from(r.overlayPng.split(",")[1], "base64"));
      await writeFile(path.join(outDir, "probe", `${r.file}-rebuilt.png`), Buffer.from(r.rebuiltPng.split(",")[1], "base64"));
    } else {
      console.log(`失败（${r.reason}）`);
    }
    results.push(r);
  } catch (error) {
    console.log("异常：", error.message);
    results.push({ file, ok: false, reason: error.message });
  }
}

const ok = results.filter((r) => r.ok);
const aggregate = {
  generatedAt: new Date().toISOString(),
  mode: "probe",
  totalFiles: files.length,
  detected: ok.length,
  longSide: ok.map((r) => r.longSide).sort((a, b) => a - b),
  usedColors: ok.map((r) => r.usedColors).sort((a, b) => a - b),
  whiteRatio: ok.map((r) => r.whiteRatio).sort((a, b) => a - b),
  singletonRatio: ok.map((r) => r.singletonRatio).filter((v) => v !== null).sort((a, b) => a - b),
  codeHistogram: {},
};
for (const r of ok) {
  for (const c of r.cellColors) {
    if (c.code === null) continue;
    aggregate.codeHistogram[c.code] = (aggregate.codeHistogram[c.code] ?? 0) + 1;
  }
}
const median = (arr) => (arr.length ? arr[Math.floor(arr.length / 2)] : null);
const quartiles = (arr) => (arr.length ? [arr[Math.floor(arr.length * 0.25)], median(arr), arr[Math.floor(arr.length * 0.75)]] : null);
aggregate.summary = {
  longSideP25P50P75: quartiles(aggregate.longSide),
  usedColorsP25P50P75: quartiles(aggregate.usedColors),
  whiteRatioP25P50P75: quartiles(aggregate.whiteRatio),
  singletonRatioP25P50P75: quartiles(aggregate.singletonRatio),
  top30Codes: Object.entries(aggregate.codeHistogram).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([code, n]) => [code, n]),
};

await writeFile(path.join(outDir, "reference-stats.json"), JSON.stringify({ results: results.map((r) => {
        const { cellColors, overlayPng, rebuiltPng, ...rest } = r;
        // 预览与逐格数据只在 probe 输出目录里出现，汇总 JSON 刻意瘦身。
        void cellColors;
        void overlayPng;
        void rebuiltPng;
        return rest;
      }), aggregate }, null, 2), "utf8");
const fmt = (q) => (q ? q.join(" / ") : "—");
console.log(`\nprobe 成功 ${ok.length}/${files.length} 张，预览在 ${path.relative(root, path.join(outDir, "probe"))}/`);
console.log("长边 P25/P50/P75:", fmt(aggregate.summary.longSideP25P50P75));
console.log("用色数 P25/P50/P75:", fmt(aggregate.summary.usedColorsP25P50P75));
console.log("白格占比% P25/P50/P75:", fmt(aggregate.summary.whiteRatioP25P50P75));
console.log("孤立豆率% P25/P50/P75:", fmt(aggregate.summary.singletonRatioP25P50P75));
console.log("Top 色号:", aggregate.summary.top30Codes.slice(0, 18).map(([c, n]) => `${c}:${n}`).join(" "));
await browser.close();
await server.close();
