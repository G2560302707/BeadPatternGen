/**
 * C4 · 真实浏览器分割冒烟测试。
 *
 * 用 Vite dev server + Playwright Chromium 跑通：
 *   解码真实照片 → 下载 / 校验模型 → WASM 推理 → 得到原图尺寸蒙版
 *
 * 用法：
 *   pnpm models:download     # 首次需要，脚本本身不下载模型
 *   pnpm smoke:segmentation [--image path/to/photo.jpg] [--model u2netp]
 *
 * 不传 --image 时使用 rembg 仓库的示例照片（仅用于本地冒烟，不随仓库分发）。
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 4187;
const imageArgIndex = process.argv.indexOf("--image");
const defaultImage = path.join(tmpdir(), "bead-pattern-smoke", "animal-1.jpg");
const imagePath =
  imageArgIndex >= 0 && process.argv[imageArgIndex + 1]
    ? path.resolve(process.argv[imageArgIndex + 1])
    : defaultImage;
const modelArgIndex = process.argv.indexOf("--model");
const modelId =
  modelArgIndex >= 0 && process.argv[modelArgIndex + 1] ? process.argv[modelArgIndex + 1] : "u2netp";

async function ensureImage() {
  try {
    return await readFile(imagePath);
  } catch {
    if (imagePath !== defaultImage) throw new Error(`找不到图片：${imagePath}`);
  }
  await mkdir(path.dirname(defaultImage), { recursive: true });
  console.log("[smoke] 下载示例图片（rembg examples/animal-1.jpg）");
  const response = await fetch(
    "https://raw.githubusercontent.com/danielgatis/rembg/main/examples/animal-1.jpg",
  );
  if (!response.ok) throw new Error(`示例图片下载失败：HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(defaultImage, bytes);
  return Buffer.from(bytes);
}

const imageBytes = await ensureImage();
const base64 = imageBytes.toString("base64");

const server = await createServer({
  root,
  logLevel: "silent",
  server: { host: "127.0.0.1", port, strictPort: true },
});
await server.listen();

const browser = await chromium.launch();
const context = await browser.newContext();

async function runSegmentation(sourceImageId) {
  const page = await context.newPage();
  const pageErrors = [];
  const modelRequests = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") console.log("[browser:error]", message.text());
  });
  page.on("request", (request) => {
    if (request.url().includes("/models/")) modelRequests.push(request.url());
  });

  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(
    async (data) => {
      const { SegmentationClient } = await import("/src/workers/segmentation-client.ts");
      const binary = atob(data.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

      const client = new SegmentationClient();
      const events = [];
      const started = performance.now();
      const candidates = await client.segment(
        {
          sourceImageId: data.sourceImageId,
          imageBytes: bytes,
          mimeType: data.mimeType,
          ...(data.modelId ? { modelId: data.modelId } : {}),
        },
        { onProgress: (progress) => events.push(progress) },
      );
      const elapsedMs = performance.now() - started;
      const candidate = candidates[0];
      let foregroundPixels = 0;
      if (candidate) {
        for (const value of candidate.mask.data) {
          if (value > candidate.mask.threshold) foregroundPixels += 1;
        }
      }
      client.dispose();
      return {
        elapsedMs,
        events,
        candidateCount: candidates.length,
        bbox: candidate?.bbox ?? null,
        confidence: candidate?.confidence ?? null,
        maskWidth: candidate?.mask.width ?? 0,
        maskHeight: candidate?.mask.height ?? 0,
        foregroundPixels,
        model: candidate?.mask.model ?? null,
        cacheKeys: await caches.keys(),
      };
    },
    { base64, mimeType: "image/jpeg", sourceImageId, modelId },
  );
  await page.close();
  return { ...result, modelRequests, pageErrors };
}

let exitCode = 0;
try {
  const result = await runSegmentation("smoke-first-run");
  const stages = [...new Set(result.events.map((event) => event.stage))];
  console.log("[smoke] 首次耗时", Math.round(result.elapsedMs), "ms");
  console.log("[smoke] 阶段", stages.join(" → "));
  console.log("[smoke] 候选", result.candidateCount, "bbox", JSON.stringify(result.bbox));
  console.log(
    "[smoke] 蒙版",
    `${result.maskWidth}×${result.maskHeight}`,
    "前景像素",
    result.foregroundPixels,
    "置信度",
    result.confidence?.toFixed(3),
  );
  console.log("[smoke] 模型", JSON.stringify(result.model));
  console.log("[smoke] 指定模型", modelId);
  console.log("[smoke] 模型网络请求", result.modelRequests.length);
  console.log("[smoke] Cache Storage", result.cacheKeys);

  if (result.candidateCount !== 1) throw new Error("没有产出候选主体");
  if (result.foregroundPixels < 100) throw new Error("蒙版前景像素过少，模型可能没有正确推理");
  if (result.maskWidth < 2 || result.maskHeight < 2) throw new Error("蒙版尺寸异常");
  if (result.modelRequests.length !== 1) throw new Error("首次运行应当下载一次模型");
  if (result.pageErrors.length > 0) throw new Error(`页面异常：${result.pageErrors.join("; ")}`);

  // 新开页面（同一个 browser context，共享 Cache Storage）验证第二次不再请求模型。
  const cached = await runSegmentation("smoke-second-run");
  console.log("[smoke] 缓存命中耗时", Math.round(cached.elapsedMs), "ms");
  console.log("[smoke] 缓存命中时模型请求", cached.modelRequests.length);
  if (cached.candidateCount !== 1) throw new Error("缓存运行没有产出候选主体");
  if (cached.modelRequests.length !== 0) {
    throw new Error("模型已缓存，但第二次运行仍发起了下载请求");
  }
  if (cached.pageErrors.length > 0) throw new Error(`页面异常：${cached.pageErrors.join("; ")}`);

  console.log("[smoke] 通过");
} catch (error) {
  exitCode = 1;
  console.error("[smoke] 失败：", error instanceof Error ? error.message : error);
} finally {
  await context.close();
  await browser.close();
  await server.close();
}

process.exit(exitCode);
