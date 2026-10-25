/**
 * 探测 ONNX 模型的输入/输出张量名（浏览器 ort-web，验证模型文件完整性）。
 * 用法：node scripts/probe-model.mjs public/models/isnet-anime.onnx
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.resolve(root, process.argv[2] ?? "public/models/isnet-anime.onnx");

const server = await createServer({
  root,
  logLevel: "silent",
  server: { host: "127.0.0.1", port: 4190, strictPort: true },
});
await server.listen();

const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", (m) => console.log("[browser]", m.text()));
await page.goto("http://127.0.0.1:4190/", { waitUntil: "domcontentloaded" });

const result = await page.evaluate(
  async (modelUrl) => {
    const ort = await import("/node_modules/onnxruntime-web/dist/ort.all.min.mjs");
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = "/node_modules/onnxruntime-web/dist/";
    const response = await fetch(modelUrl);
    const buffer = await response.arrayBuffer();
    const started = performance.now();
    const session = await ort.InferenceSession.create(new Uint8Array(buffer), {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "basic",
    });
    const elapsed = Math.round(performance.now() - started);
    const shape = (t) => (t ?? []).map((d) => (typeof d === "bigint" ? Number(d) : d));
    return {
      elapsed,
      byteLength: buffer.byteLength,
      inputNames: session.inputNames,
      outputNames: session.outputNames,
      inputMetadata: (session.inputMetadata ?? []).map((m) => ({
        name: m.name,
        shape: shape(m.shape),
      })),
    };
  },
  path.relative(root, target).split(path.sep).join("/"),
);

console.log(JSON.stringify(result, null, 2));
await browser.close();
await server.close();
