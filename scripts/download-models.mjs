/**
 * C4 · 按 model-manifest.json 下载分割模型。
 *
 * 用法：
 *   pnpm models:download          # 缺失 / 校验失败时下载
 *   pnpm models:download --force  # 强制重新下载
 *
 * 模型文件较大且不随仓库分发（见 .gitignore），首次开发需要执行一次。
 * 下载后会用清单里的 byteLength + sha256 校验，避免代理 / 镜像返回坏文件。
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "src/core/subject/segmentation/model-manifest.json");
const outputDir = path.join(root, "public/models");
const force = process.argv.includes("--force");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fileMatches(file, model) {
  try {
    const info = await stat(file);
    if (info.size !== model.byteLength) return false;
    const bytes = await readFile(file);
    return sha256(bytes) === model.sha256;
  } catch {
    return false;
  }
}

await mkdir(outputDir, { recursive: true });

let downloaded = 0;
for (const model of manifest.models) {
  const dest = path.join(outputDir, model.fileName);
  if (!force && (await fileMatches(dest, model))) {
    console.log(`[models] ${model.id}: 已就绪（${model.byteLength} 字节，校验通过）`);
    continue;
  }

  console.log(`[models] ${model.id}: 下载 ${model.sourceUrl}`);
  const response = await fetch(model.sourceUrl, {
    headers: { "user-agent": "bead-pattern-generator/build-script" },
    redirect: "follow",
  });
  if (!response.ok) {
    throw new Error(`下载失败：HTTP ${response.status} ${response.statusText}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== model.byteLength) {
    throw new Error(
      `文件大小不符：期望 ${model.byteLength}，实际 ${bytes.byteLength}。请检查网络代理或清单。`,
    );
  }
  const actual = sha256(bytes);
  if (actual !== model.sha256) {
    throw new Error(
      `SHA-256 不符：期望 ${model.sha256}，实际 ${actual}。已拒绝写入，请检查下载源。`,
    );
  }

  const temp = `${dest}.part`;
  await writeFile(temp, bytes);
  await rename(temp, dest);
  downloaded += 1;
  console.log(`[models] ${model.id}: 已写入 public/models/${model.fileName}`);
}

console.log(
  downloaded === 0 ? "[models] 全部模型已就绪。" : `[models] 完成，本次下载 ${downloaded} 个模型。`,
);
