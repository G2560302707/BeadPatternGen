/**
 * C4 · 从 onnxruntime-web 复制 wasm 运行时到 public/ort/。
 *
 * onnxruntime-web 的 .wasm / .mjs 不能被打进 bundle，必须在运行时按 URL 加载。
 * `predev` / `prebuild` 会自动执行本脚本；public/ort 已加入 .gitignore。
 */

import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(root, "node_modules/onnxruntime-web/dist");
const targetDir = path.join(root, "public/ort");

// 默认入口（含 WebGPU / WASM 两个执行提供者）只引用 jsep 这一组运行时。
const files = ["ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"];

await mkdir(targetDir, { recursive: true });

for (const name of files) {
  const source = path.join(sourceDir, name);
  const target = path.join(targetDir, name);
  const sourceInfo = await stat(source);
  const targetInfo = await stat(target).catch(() => null);
  if (targetInfo && targetInfo.size === sourceInfo.size) continue;
  await copyFile(source, target);
  console.log(`[ort] 已复制 ${name}（${(sourceInfo.size / 1024 / 1024).toFixed(1)} MB）`);
}

console.log("[ort] wasm 运行时已就绪：public/ort/");
