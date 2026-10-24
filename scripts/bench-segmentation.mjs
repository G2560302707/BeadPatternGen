/**
 * S0 · 分割质量基准：多模型 × 多图，真实浏览器推理，导出蒙版预览与指标。
 *
 * 用法：
 *   node scripts/bench-segmentation.mjs [--models u2netp,silueta]
 *                                       [--images bench/images]
 *                                       [--out bench/results]
 *
 * - 模型清单来自 src/core/subject/segmentation/model-manifest.json（缺省全部）。
 * - 图片目录缺省 bench/images；为空时自动下载 rembg examples（仅本地验证，不随仓库分发），
 *   也支持手动放任意 jpg/png（把抠不好的原图丢进去即可）。
 * - 每张预览：绿色 = 判定前景；橙色 = 弱响应带（32 < v ≤ 阈值，模型不确定区）。
 * - 输出 summary.md / results.json / <model>--<image>.png 到 --out 目录。
 */

/* global Blob, createImageBitmap, document */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 4188;

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const imagesDir = path.resolve(root, argValue("--images", "bench/images"));
const outDir = path.resolve(root, argValue("--out", "bench/results"));
const manifest = JSON.parse(
  await readFile(path.join(root, "src/core/subject/segmentation/model-manifest.json"), "utf8"),
);
const modelsArg = argValue("--models", null);
const models = modelsArg
  ? manifest.models.filter((model) => modelsArg.split(",").includes(model.id))
  : manifest.models;

if (models.length === 0) throw new Error("没有可测模型（--models 过滤后为空）");

const DEFAULT_EXAMPLES = [
  "animal-1.jpg",
  "animal-2.jpg",
  "animal-3.jpg",
  "anime-girl-1.jpg",
  "anime-girl-2.jpg",
  "car-1.jpg",
  "car-2.jpg",
  "food-2.jpg",
  "person-1.jpg",
  "person-2.jpg",
];

async function fetchWithMirror(url) {
  const attempts = [url, `https://gh-proxy.com/${url}`];
  for (const attempt of attempts) {
    try {
      const response = await fetch(attempt, {
        headers: { "user-agent": "bead-pattern-generator/bench" },
      });
      if (response.ok) return new Uint8Array(await response.arrayBuffer());
    } catch {
      // 换下一个源
    }
  }
  return null;
}

async function ensureImages() {
  const entries = await readdir(imagesDir).catch(() => []);
  const files = entries.filter((name) => /\.(jpe?g|png|webp)$/i.test(name));
  if (files.length > 0) {
    return files.map((name) => path.join(imagesDir, name));
  }
  await mkdir(imagesDir, { recursive: true });
  console.log(`[bench] ${imagesDir} 为空，下载 rembg 示例图`);
  const saved = [];
  for (const name of DEFAULT_EXAMPLES) {
    const bytes = await fetchWithMirror(
      `https://raw.githubusercontent.com/danielgatis/rembg/main/examples/${name}`,
    );
    if (!bytes) {
      console.log(`[bench] 跳过（下载失败）${name}`);
      continue;
    }
    const dest = path.join(imagesDir, name);
    await writeFile(dest, bytes);
    saved.push(dest);
    console.log(`[bench] 已下载 ${name}（${bytes.byteLength} 字节）`);
  }
  if (saved.length === 0) throw new Error("没有可用测试图");
  return saved;
}

const imagePaths = await ensureImages();
await mkdir(outDir, { recursive: true });

const server = await createServer({
  root,
  logLevel: "silent",
  server: { host: "127.0.0.1", port, strictPort: true },
});
await server.listen();

const browser = await chromium.launch();
const context = await browser.newContext();

async function benchOne(modelId, imagePath, sourceImageId) {
  const bytes = new Uint8Array(await readFile(imagePath));
  const base64 = Buffer.from(bytes).toString("base64");
  const mimeType = imagePath.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(
    async (data) => {
      const { SegmentationClient } = await import("/src/workers/segmentation-client.ts");
      const binary = atob(data.base64);
      const raw = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) raw[i] = binary.charCodeAt(i);

      const client = new SegmentationClient();
      const started = performance.now();
      let candidates;
      try {
        candidates = await client.segment(
          {
            sourceImageId: data.sourceImageId,
            imageBytes: raw,
            mimeType: data.mimeType,
            modelId: data.modelId,
          },
          { onProgress: () => undefined },
        );
      } catch (error) {
        const failure = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        client.dispose();
        return { failure };
      }
      const elapsedMs = performance.now() - started;
      client.dispose();

      const candidate = candidates[0];
      if (!candidate) return { failure: "没有候选", elapsedMs };

      const { mask, bbox } = candidate;
      let foreground = 0;
      let weakBand = 0;
      for (const value of mask.data) {
        if (value > mask.threshold) foreground += 1;
        else if (value > 32) weakBand += 1;
      }
      const foregroundRatio = foreground / mask.data.length;
      const weakRatio = weakBand / mask.data.length;
      const edgeContacts =
        (bbox.x <= 0 ? 1 : 0) +
        (bbox.y <= 0 ? 1 : 0) +
        (bbox.x + bbox.width >= mask.width ? 1 : 0) +
        (bbox.y + bbox.height >= mask.height ? 1 : 0);

      // 预览图：原图 + 绿色前景 / 橙色弱响应带。
      const blob = new Blob([raw.buffer], { type: data.mimeType });
      const bitmap = await createImageBitmap(blob);
      const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
      const width = Math.round(bitmap.width * scale);
      const height = Math.round(bitmap.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0, width, height);
      const pixels = ctx.getImageData(0, 0, width, height);
      const sx = mask.width / width;
      const sy = mask.height / height;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const value = mask.data[Math.floor(y * sy) * mask.width + Math.floor(x * sx)] ?? 0;
          const index = (y * width + x) * 4;
          if (value > mask.threshold) {
            pixels.data[index + 1] = Math.min(255, pixels.data[index + 1] + 90);
            pixels.data[index] = Math.round(pixels.data[index] * 0.45);
            pixels.data[index + 2] = Math.round(pixels.data[index + 2] * 0.55);
          } else if (value > 32) {
            pixels.data[index] = Math.min(255, pixels.data[index] + 110);
            pixels.data[index + 1] = Math.round(pixels.data[index + 1] * 0.75 + 50);
            pixels.data[index + 2] = Math.round(pixels.data[index + 2] * 0.4);
          }
        }
      }
      ctx.putImageData(pixels, 0, 0);
      bitmap.close?.();
      return {
        elapsedMs,
        confidence: candidate.confidence,
        bbox,
        maskSize: [mask.width, mask.height],
        threshold: mask.threshold,
        foregroundRatio,
        weakRatio,
        edgeContacts,
        preview: canvas.toDataURL("image/png"),
      };
    },
    { base64, mimeType, modelId, sourceImageId },
  );
  await page.close();
  return { ...result, pageErrors };
}

const results = [];
for (const model of models) {
  for (const imagePath of imagePaths) {
    const imageName = path.basename(imagePath).replace(/\.[^.]+$/, "");
    process.stdout.write(`[bench] ${model.id} × ${imageName} ... `);
    const outcome = await benchOne(model.id, imagePath, `bench-${model.id}-${imageName}`);
    if (outcome.failure) {
      console.log(`失败：${outcome.failure}`);
      results.push({ model: model.id, image: imageName, failure: outcome.failure });
      continue;
    }
    const previewBase64 = outcome.preview.split(",")[1] ?? "";
    await writeFile(
      path.join(outDir, `${model.id}--${imageName}.png`),
      Buffer.from(previewBase64, "base64"),
    );
    delete outcome.preview;
    const record = { model: model.id, image: imageName, ...outcome };
    results.push(record);
    console.log(
      `${Math.round(outcome.elapsedMs)}ms · 前景 ${(outcome.foregroundRatio * 100).toFixed(1)}% · 弱带 ${(outcome.weakRatio * 100).toFixed(1)}% · 贴边 ${outcome.edgeContacts} · 阈值 ${outcome.threshold}`,
    );
  }
}

await context.close();
await browser.close();
await server.close();

const ok = results.filter((item) => !item.failure);
const summaryLines = [
  "# 分割基准结果",
  "",
  `日期：${new Date().toISOString()}`,
  `图片目录：${path.relative(root, imagesDir)}（${imagePaths.length} 张）`,
  "",
  "| 模型 | 图片 | 耗时 ms | 前景占比 | 弱响应带 | 置信度 | bbox 贴边数 | 阈值 |",
  "| --- | --- | --- | --- | --- | --- | --- | --- |",
];
for (const item of ok) {
  summaryLines.push(
    `| ${item.model} | ${item.image} | ${Math.round(item.elapsedMs)} | ${(item.foregroundRatio * 100).toFixed(1)}% | ${(item.weakRatio * 100).toFixed(1)}% | ${(item.confidence * 100).toFixed(0)}% | ${item.edgeContacts} | ${item.threshold} |`,
  );
}
const failures = results.filter((item) => item.failure);
if (failures.length > 0) {
  summaryLines.push("", "## 失败记录", "");
  for (const item of failures) summaryLines.push(`- ${item.model} × ${item.image}：${item.failure}`);
}
await writeFile(path.join(outDir, "summary.md"), summaryLines.join("\n"), "utf8");
await writeFile(path.join(outDir, "results.json"), JSON.stringify(results, null, 2), "utf8");
console.log(`\n[bench] 完成：${ok.length} 成功 / ${failures.length} 失败，结果在 ${path.relative(root, outDir)}/`);
process.exit(failures.length > 0 && ok.length === 0 ? 1 : 0);
