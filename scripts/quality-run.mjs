/**
 * 图纸质量全链路跑测：真实浏览器分割 + 纯函数生成流水线，逐图输出审查图。
 *
 * 用法：
 *   node scripts/quality-run.mjs [--images 测试图集] [--out 测试输出]
 *                                [--model isnet-general-use] [--sizes 26,52,78]
 *                                [--colors 16] [--mode anime] [--only 关键字]
 *
 * 每张图产出：
 *   <name>-detect.png   原图 / 蒙版叠加 / 抠图预览 三联
 *   <name>-pattern.png  各尺寸图纸渲染 三联（透明背景画成棋盘格）
 *   summary.json        每图的置信度 / 阈值 / 用色数 / 平均 ΔE 等
 *
 * 目的：把「主体识别残缺」「小尺寸失真」两个问题纳入可重复的目检流程。
 */

/* global Blob, createImageBitmap, document, ImageData */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 4189;

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const imagesDir = path.resolve(root, argValue("--images", "测试图集"));
const outDir = path.resolve(root, argValue("--out", "测试输出"));
const modelId = argValue("--model", null);
const sizes = argValue("--sizes", "26,52,78")
  .split(",")
  .map((value) => Number.parseInt(value, 10))
  .filter((value) => Number.isInteger(value) && value >= 8 && value <= 256);
const maxColors = Number.parseInt(argValue("--colors", "16"), 10);
const mode = argValue("--mode", "anime");
const only = argValue("--only", null);

await mkdir(outDir, { recursive: true });
const entries = await readdir(imagesDir);
const imageFiles = entries
  .filter((name) => /\.(jpe?g|png|webp)$/i.test(name))
  .filter((name) => (only ? name.includes(only) : true))
  .sort();
if (imageFiles.length === 0) throw new Error(`没有可测图片：${imagesDir}`);

const server = await createServer({
  root,
  logLevel: "silent",
  server: { host: "127.0.0.1", port, strictPort: true },
});
await server.listen();

const browser = await chromium.launch();
const context = await browser.newContext();

async function processOne(imagePath, sourceImageId) {
  const bytes = new Uint8Array(await readFile(imagePath));
  const base64 = Buffer.from(bytes).toString("base64");
  const mimeType = imagePath.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";

  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(
    async (data) => {
      const { detectSubjectsInBrowser } = await import("/src/workers/subject-service.ts");
      const { sampleToGrid } = await import("/src/core/sampling/index.ts");
      const { generatePattern } = await import("/src/core/pipeline/index.ts");
      const { paletteColors } = await import("/src/features/palette-panel/locked-palette.ts");
      const { computeRimMask } = await import("/src/core/modes/outline.ts");
      const { deltaE2000, rgbToLab, hexToRgb } = await import("/src/core/color/index.ts");

      const binary = atob(data.base64);
      const raw = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) raw[i] = binary.charCodeAt(i);

      // 解码原图
      const blob = new Blob([raw.buffer], { type: data.mimeType });
      const bitmap = await createImageBitmap(blob);
      const decodeCanvas = document.createElement("canvas");
      decodeCanvas.width = bitmap.width;
      decodeCanvas.height = bitmap.height;
      const decodeCtx = decodeCanvas.getContext("2d", { willReadFrequently: true });
      decodeCtx.drawImage(bitmap, 0, 0);
      const sourceImageData = decodeCtx.getImageData(0, 0, bitmap.width, bitmap.height);
      const source = {
        width: bitmap.width,
        height: bitmap.height,
        data: sourceImageData.data,
      };

      // 主体识别（persist:false 不落库）
      let detection = null;
      let detectFailure = null;
      const started = performance.now();
      try {
        const outcome = await detectSubjectsInBrowser({
          sourceImageId: data.sourceImageId,
          imageBytes: raw,
          mimeType: data.mimeType,
          persist: false,
          ...(data.modelId ? { modelId: data.modelId } : {}),
        });
        detection = {
          elapsedMs: performance.now() - started,
          candidateCount: outcome.candidates.length,
          dropped: outcome.droppedCandidates,
          confidence: outcome.candidates[0]?.confidence ?? null,
          threshold: outcome.candidates[0]?.mask.threshold ?? null,
          bbox: outcome.candidates[0]?.bbox ?? null,
          mask: outcome.candidates[0]?.mask ?? null,
        };
      } catch (error) {
        detectFailure = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      }

      // 抠图：主体 bbox 充满透明画布（等价 composeImage transparent + subjectScale 1）
      let composed = null;
      if (detection?.mask && detection.bbox) {
        const bbox = detection.bbox;
        const maskData = detection.mask.data;
        const out = new Uint8ClampedArray(bbox.width * bbox.height * 4);
        for (let row = 0; row < bbox.height; row += 1) {
          const sourceRow = bbox.y + row;
          for (let col = 0; col < bbox.width; col += 1) {
            const sourceIndex = sourceRow * source.width + bbox.x + col;
            const maskAlpha = maskData[sourceIndex] ?? 0;
            const sourceOffset = sourceIndex * 4;
            const sourceAlpha = source.data[sourceOffset + 3] ?? 255;
            const effective = (maskAlpha * sourceAlpha) / 255;
            const outOffset = (row * bbox.width + col) * 4;
            out[outOffset] = source.data[sourceOffset] ?? 0;
            out[outOffset + 1] = source.data[sourceOffset + 1] ?? 0;
            out[outOffset + 2] = source.data[sourceOffset + 2] ?? 0;
            out[outOffset + 3] = effective;
          }
        }
        composed = { width: bbox.width, height: bbox.height, data: out };
      }

      // 各尺寸生成
      const palette = paletteColors("mard-221");
      const patterns = [];
      if (composed) {
        for (const size of data.sizes) {
          const long = Math.max(composed.width, composed.height);
          const short = Math.min(composed.width, composed.height);
          const gridLong = size;
          const gridShort = Math.max(1, Math.round((gridLong * short) / long));
          const gridW = composed.width >= composed.height ? gridLong : gridShort;
          const gridH = composed.width >= composed.height ? gridShort : gridLong;

          const sampled = sampleToGrid(
            composed,
            gridW,
            gridH,
            { x: 0, y: 0, width: composed.width, height: composed.height },
            "empty",
          );
          const generated = generatePattern({
            rgb: sampled.rgb,
            alpha: sampled.alpha,
            width: gridW,
            height: gridH,
            palette,
            paletteId: "mard-221-mini-2.6mm",
            paletteVersion: "1",
            maxColors: data.maxColors,
            mode: data.mode,
            dithering: "none",
            colorMetric: "ciede2000",
            transparentPolicy: "empty",
            ditherStrength: 1,
            source: {
              originalWidth: source.width,
              originalHeight: source.height,
              aspectRatio: source.width / source.height,
            },
            title: "quality-run",
            id: `quality-${size}`,
          });
          const nonEmpty = generated.pattern.cells.filter((cell) => cell >= 0).length;
          const usedColors = new Set(generated.pattern.cells.filter((cell) => cell >= 0)).size;
          // S11.1 指标：浅色段描边覆盖率 + 自然断线比。
          // 「该描的格」= 内侧参考色 L ≥ 46（中和档豁免线，与 rimStrength 0.75 对应）；
          // 覆盖率 = 该描格中映射为深色（L<45）的比例；断线比 = 豁免格 / 全部轮廓格。
          const rimMask = computeRimMask(sampled.alpha, gridW, gridH);
          let rimCount = 0;
          let rimSkipped = 0;
          let rimDark = 0;
          for (let y = 0; y < gridH; y += 1) {
            for (let x = 0; x < gridW; x += 1) {
              const i = y * gridW + x;
              if (rimMask[i] !== 1) continue;
              rimCount += 1;
              // 内侧参考色（4 邻非空格采样 Lab 均值）
              let sl = 0;
              let n = 0;
              for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= gridW || ny >= gridH) continue;
                const ni = ny * gridW + nx;
                if ((sampled.alpha[ni] ?? 0) < 128) continue;
                sl += rgbToLab({ r: sampled.rgb[ni * 3] ?? 0, g: sampled.rgb[ni * 3 + 1] ?? 0, b: sampled.rgb[ni * 3 + 2] ?? 0 }).L;
                n += 1;
              }
              const innerL = n > 0 ? sl / n : 100;
              if (innerL < 46) {
                rimSkipped += 1;
                continue;
              }
              const value = generated.pattern.cells[i];
              const hex = generated.pattern.palette[value]?.hex;
              if (hex && rgbToLab(hexToRgb(hex)).L < 45) rimDark += 1;
            }
          }
          // S11 指标：色块过渡率（每百格相邻异色对数，越低越干净）
          let transitions = 0;
          for (let y = 0; y < gridH; y += 1) {
            for (let x = 0; x < gridW; x += 1) {
              const cell = generated.pattern.cells[y * gridW + x];
              if (cell < 0) continue;
              const right = x + 1 < gridW ? generated.pattern.cells[y * gridW + x + 1] : -1;
              const down = y + 1 < gridH ? generated.pattern.cells[(y + 1) * gridW + x] : -1;
              if (right >= 0 && right !== cell) transitions += 1;
              if (down >= 0 && down !== cell) transitions += 1;
            }
          }
          // 平均 ΔE2000（非空格，采样色 vs 豆色），衡量量化保真度。
          // S11：另报 interiorDeltaE（剔除轮廓格）——轮廓被有意描成深色，
          // 全格均值混入描边成本后与旧版本不可比，内部格才是量化保真度本体。
          const paletteRgb = generated.pattern.palette.map((color) => hexToRgb(color.hex));
          let deltaSum = 0;
          let deltaCount = 0;
          let interiorSum = 0;
          let interiorCount = 0;
          for (let i = 0; i < generated.pattern.cells.length; i += 1) {
            const value = generated.pattern.cells[i];
            if (value < 0) continue;
            const sample = {
              r: sampled.rgb[i * 3] ?? 0,
              g: sampled.rgb[i * 3 + 1] ?? 0,
              b: sampled.rgb[i * 3 + 2] ?? 0,
            };
            const bead = paletteRgb[value];
            if (!bead) continue;
            const delta = deltaE2000(rgbToLab(sample), rgbToLab(bead));
            deltaSum += delta;
            deltaCount += 1;
            if (rimMask[i] !== 1) {
              interiorSum += delta;
              interiorCount += 1;
            }
          }
          patterns.push({
            size,
            gridW,
            gridH,
            nonEmpty,
            usedColors,
            meanDeltaE: deltaCount > 0 ? deltaSum / deltaCount : null,
            interiorDeltaE: interiorCount > 0 ? interiorSum / interiorCount : null,
            isolated: generated.diagnostic.isolated.length,
            fragments: generated.diagnostic.fragments.length,
            rimCount,
            rimCoveredRatio: rimCount - rimSkipped > 0 ? rimDark / (rimCount - rimSkipped) : null,
            rimSkipRatio: rimCount > 0 ? rimSkipped / rimCount : null,
            transitionsPer100: nonEmpty > 0 ? (transitions / nonEmpty) * 100 : null,
            cells: Array.from(generated.pattern.cells),
            paletteUsed: generated.pattern.palette.map((color) => ({
              code: color.code,
              hex: color.hex,
            })),
          });
        }
      }

      // 三联审查图：原图 / 蒙版叠加 / 抠图
      const cell = 420;
      const pad = 12;
      const sheet = document.createElement("canvas");
      sheet.width = cell * 3 + pad * 4;
      sheet.height = cell + pad * 2;
      const ctx = sheet.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, sheet.width, sheet.height);
      const drawContain = (image, x, y) => {
        const scale = Math.min(cell / image.width, cell / image.height);
        const w = image.width * scale;
        const h = image.height * scale;
        ctx.drawImage(image, x + (cell - w) / 2, y + (cell - h) / 2, w, h);
      };
      drawContain(bitmap, pad, pad);

      // 蒙版叠加（绿=前景 橙=弱响应带）
      if (detection?.mask) {
        const overlay = document.createElement("canvas");
        overlay.width = source.width;
        overlay.height = source.height;
        const octx = overlay.getContext("2d");
        const overlayData = octx.createImageData(source.width, source.height);
        overlayData.data.set(source.data);
        const maskData = detection.mask.data;
        const threshold = detection.mask.threshold;
        for (let i = 0; i < maskData.length; i += 1) {
          const value = maskData[i];
          const offset = i * 4;
          if (value > threshold) {
            overlayData.data[offset + 1] = Math.min(255, overlayData.data[offset + 1] + 90);
            overlayData.data[offset] = Math.round(overlayData.data[offset] * 0.45);
            overlayData.data[offset + 2] = Math.round(overlayData.data[offset + 2] * 0.55);
          } else if (value > 32) {
            overlayData.data[offset] = Math.min(255, overlayData.data[offset] + 110);
            overlayData.data[offset + 1] = Math.round(overlayData.data[offset + 1] * 0.75 + 50);
            overlayData.data[offset + 2] = Math.round(overlayData.data[offset + 2] * 0.4);
          }
        }
        octx.putImageData(overlayData, 0, 0);
        drawContain(overlay, cell + pad * 2, pad);
      }

      // 抠图预览（棋盘格衬底）
      if (composed) {
        const checker = document.createElement("canvas");
        checker.width = composed.width;
        checker.height = composed.height;
        const cctx = checker.getContext("2d");
        const tile = 16;
        for (let y = 0; y < composed.height; y += tile) {
          for (let x = 0; x < composed.width; x += tile) {
            cctx.fillStyle = ((x / tile + y / tile) | 0) % 2 === 0 ? "#d9d9d9" : "#f2f2f2";
            cctx.fillRect(x, y, tile, tile);
          }
        }
        const composedImage = new ImageData(
          new Uint8ClampedArray(composed.data),
          composed.width,
          composed.height,
        );
        cctx.putImageData(composedImage, 0, 0);
        drawContain(checker, (cell + pad) * 2 + pad, pad);
      }

      return {
        detection: detection
          ? { ...detection, mask: undefined }
          : null,
        detectFailure,
        patterns,
        sheet: sheet.toDataURL("image/png"),
        sourceSize: [source.width, source.height],
        pageErrors: [],
      };
    },
    { base64, mimeType, sourceImageId, modelId, sizes, maxColors, mode },
  );

  // 图纸三联图单独画（利用返回的 cells/palette）
  const patternSheet = await page.evaluate(
    async (data) => {
      const cellPx = 10;
      const pad = 16;
      const layouts = data.patterns.map((pattern) => ({
        width: pattern.gridW * cellPx + pad * 2,
        height: pattern.gridH * cellPx + pad * 2,
      }));
      const sheet = document.createElement("canvas");
      sheet.width = layouts.reduce((sum, layout) => sum + layout.width + pad, 0);
      sheet.height = Math.max(...layouts.map((layout) => layout.height)) + pad;
      const ctx = sheet.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, sheet.width, sheet.height);

      let cursorX = pad;
      for (const [index, pattern] of data.patterns.entries()) {
        const originX = cursorX;
        const originY = pad;
        // 棋盘格背景
        for (let gy = 0; gy < pattern.gridH; gy += 1) {
          for (let gx = 0; gx < pattern.gridW; gx += 1) {
            ctx.fillStyle = (gx + gy) % 2 === 0 ? "#e8e8e8" : "#f6f6f6";
            ctx.fillRect(originX + gx * cellPx, originY + gy * cellPx, cellPx, cellPx);
          }
        }
        // 豆子
        for (let gy = 0; gy < pattern.gridH; gy += 1) {
          for (let gx = 0; gx < pattern.gridW; gx += 1) {
            const cellIndex = gy * pattern.gridW + gx;
            const value = pattern.cells[cellIndex];
            if (value < 0) continue;
            ctx.fillStyle = pattern.paletteUsed[value]?.hex ?? "#000";
            ctx.fillRect(
              originX + gx * cellPx + 0.5,
              originY + gy * cellPx + 0.5,
              cellPx - 1,
              cellPx - 1,
            );
          }
        }
        ctx.fillStyle = "#333";
        ctx.font = "14px sans-serif";
        ctx.fillText(
          `${pattern.size} 格 · ${pattern.usedColors} 色 · ${pattern.nonEmpty} 豆`,
          originX + 2,
          Math.max(...layouts.map((layout) => layout.height)) + pad - 2,
        );
        cursorX += layouts[index].width + pad;
      }
      return sheet.toDataURL("image/png");
    },
    { patterns: result.patterns },
  );

  await page.close();
  return { ...result, patternSheet, pageErrors };
}

const summary = [];
let index = 0;
for (const file of imageFiles) {
  index += 1;
  const name = file.replace(/\.[^.]+$/, "");
  process.stdout.write(`[${index}/${imageFiles.length}] ${file} ... `);
  try {
    const outcome = await processOne(path.join(imagesDir, file), `quality-${name}`);
    const safeName = name.replace(/[^\w\u4e00-\u9fa5.-]+/g, "_");
    await writeFile(
      path.join(outDir, `${safeName}-detect.png`),
      Buffer.from(outcome.sheet.split(",")[1] ?? "", "base64"),
    );
    await writeFile(
      path.join(outDir, `${safeName}-pattern.png`),
      Buffer.from(outcome.patternSheet.split(",")[1] ?? "", "base64"),
    );
    summary.push({
      image: file,
      sourceSize: outcome.sourceSize,
      detection: outcome.detection,
      detectFailure: outcome.detectFailure,
      patterns: outcome.patterns.map((pattern) => ({
        size: pattern.size,
        grid: `${pattern.gridW}x${pattern.gridH}`,
        nonEmpty: pattern.nonEmpty,
        usedColors: pattern.usedColors,
        meanDeltaE: pattern.meanDeltaE,
        interiorDeltaE: pattern.interiorDeltaE,
        isolated: pattern.isolated,
        fragments: pattern.fragments,
        rimCount: pattern.rimCount,
        rimCoveredRatio: pattern.rimCoveredRatio,
        rimSkipRatio: pattern.rimSkipRatio,
        transitionsPer100: pattern.transitionsPer100,
        codes: [...new Set(pattern.paletteUsed.map((color) => color.code))],
      })),
    });
    const detection = outcome.detection;
    console.log(
      detection
        ? `置信度 ${(detection.confidence * 100).toFixed(0)}% · 阈值 ${detection.threshold} · ${Math.round(detection.elapsedMs)}ms`
        : `识别失败：${outcome.detectFailure}`,
    );
    if (outcome.pageErrors.length > 0) console.log("  [pageerror]", outcome.pageErrors.join("; "));
  } catch (error) {
    console.log("失败：", error instanceof Error ? error.message : String(error));
    summary.push({ image: file, failure: String(error) });
  }
}

await writeFile(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
await browser.close();
await server.close();
console.log(`\n完成：${summary.length} 张，输出在 ${path.relative(root, outDir)}/`);
