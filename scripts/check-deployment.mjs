#!/usr/bin/env node
/**
 * 部署验收：检查一个已上线的 BeadPatternGen 站点是否满足运行条件。
 *
 * 用法：
 *   node scripts/check-deployment.mjs https://example.com/
 *   node scripts/check-deployment.mjs https://example.com/bead/
 *   DEPLOY_URL=https://example.com/ pnpm deploy:check
 *
 * 选项：
 *   --skip-models          跳过分割模型检查（只验静态壳）
 *   --strict              把警告（缺少 COOP/COEP、未上 HTTPS 等）也视为失败
 *
 * 只发 HEAD / GET，不下载完整模型；退出码 0 = 通过，1 = 有失败项。
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  await readFile(path.join(root, "src/core/subject/segmentation/model-manifest.json"), "utf8"),
);

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((arg) => arg.startsWith("--")));
const positional = argv.find((arg) => !arg.startsWith("--"));
const rawTarget = positional ?? process.env.DEPLOY_URL ?? "http://127.0.0.1:4173/";

let base;
try {
  base = new URL(rawTarget.endsWith("/") ? rawTarget : `${rawTarget}/`);
} catch {
  console.error(`部署地址不合法：${rawTarget}`);
  process.exit(1);
}

const skipModels = flags.has("--skip-models");
const strict = flags.has("--strict");

const checks = [];

function add(ok, title, detail, options = {}) {
  checks.push({ ok, title, detail, warning: options.warning === true });
  const icon = ok ? (options.warning ? "!" : "✓") : "✗";
  const suffix = detail ? ` · ${detail}` : "";
  console.log(`${icon} ${title}${suffix}`);
}

function fail(title, detail) {
  add(false, title, detail);
}

function warn(ok, title, detail) {
  add(ok, title, detail, { warning: true });
}

const timeout = () => AbortSignal.timeout(20_000);

async function request(url, method = "GET") {
  try {
    return await fetch(url, { method, redirect: "follow", signal: timeout() });
  } catch (error) {
    fail(`请求失败 ${url}`, error instanceof Error ? error.message : String(error));
    return null;
  }
}

/** 部分静态服务器不支持 HEAD，退回 Range GET（只取 1 字节，不下载大文件）。 */
async function probe(url) {
  try {
    const head = await fetch(url, { method: "HEAD", redirect: "follow", signal: timeout() });
    if (head.status !== 405 && head.status !== 501) return head;
  } catch {
    // HEAD 连接失败时继续尝试 Range GET，避免重复报错。
  }
  try {
    return await fetch(url, {
      headers: { Range: "bytes=0-0" },
      redirect: "follow",
      signal: timeout(),
    });
  } catch (error) {
    fail(`请求失败 ${url}`, error instanceof Error ? error.message : String(error));
    return null;
  }
}

function header(response, name) {
  return response?.headers.get(name) ?? "";
}

/** HEAD 不可用时退回 Range GET，成功状态可能是 200 或 206。 */
function isOk(response) {
  return response?.status === 200 || response?.status === 206;
}

function isHtml(contentType) {
  return contentType.toLowerCase().includes("text/html");
}

function isJavaScript(contentType) {
  const value = contentType.toLowerCase();
  return value.includes("javascript") || value.includes("ecmascript");
}

console.log(`\n部署验收：${base.href}\n`);

// 1. 首页与关键响应头 -------------------------------------------------------
const indexResponse = await request(base.href);
if (indexResponse) {
  add(indexResponse.status === 200, "首页可访问", `HTTP ${indexResponse.status}`);
  const contentType = header(indexResponse, "content-type");
  add(isHtml(contentType), "首页 Content-Type", contentType || "(缺失)");

  const coop = header(indexResponse, "cross-origin-opener-policy").trim().toLowerCase();
  const coep = header(indexResponse, "cross-origin-embedder-policy").trim().toLowerCase();
  const isolated = coop === "same-origin" && coep === "require-corp";
  add(
    isolated,
    "跨源隔离响应头（COOP/COEP）",
    isolated
      ? "Cross-Origin-Opener-Policy: same-origin; Cross-Origin-Embedder-Policy: require-corp"
      : `COOP=${coop || "(缺失)"} COEP=${coep || "(缺失)"}；缺少时分割退回单线程 WASM`,
    { warning: !isolated },
  );

  const cacheControl = header(indexResponse, "cache-control").toLowerCase();
  if (!cacheControl || (!cacheControl.includes("no-cache") && !cacheControl.includes("no-store"))) {
    warn(
      false,
      "首页缓存策略",
      `Cache-Control: ${cacheControl || "(未设置)"}；建议 no-cache，避免发布后仍加载旧 index.html`,
    );
  } else {
    add(true, "首页缓存策略", cacheControl);
  }

  // 2. 从 index.html 找哈希资源并验证 --------------------------------------
  const html = await indexResponse.text();
  const assetUrls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((value) => value !== undefined && /\/assets\/[^"]+\.(?:js|css)$/.test(value));

  if (assetUrls.length === 0) {
    fail("入口资源检查", "index.html 中没有找到 /assets/*.js 或 *.css");
  } else {
    let assetOk = true;
    for (const assetUrl of assetUrls.slice(0, 6)) {
      const url = new URL(assetUrl, base.href).href;
      const response = await probe(url);
      if (!isOk(response)) {
        assetOk = false;
        fail("入口资源可访问", `${url} → HTTP ${response?.status ?? "无响应"}`);
        continue;
      }
      const type = header(response, "content-type");
      const expected = assetUrl.endsWith(".css") ? type.toLowerCase().includes("text/css") : isJavaScript(type);
      if (!expected) {
        assetOk = false;
        fail("入口资源 MIME", `${assetUrl} → ${type || "(缺失)"}`);
      }
    }
    if (assetOk) add(true, "入口资源", `检查 ${Math.min(assetUrls.length, 6)} 个 /assets/*.js|css`);
  }
}

// 3. onnxruntime 运行时 -----------------------------------------------------
for (const fileName of ["ort-wasm-simd-threaded.jsep.wasm", "ort-wasm-simd-threaded.jsep.mjs"]) {
  const url = new URL(`ort/${fileName}`, base.href).href;
  const response = await probe(url);
  if (!response) continue;
  if (!isOk(response)) {
    fail("ORT 运行时", `${url} → HTTP ${response.status}（检查 dist/ort 是否部署）`);
    continue;
  }
  const type = header(response, "content-type");
  if (fileName.endsWith(".wasm")) {
    add(type.toLowerCase().includes("application/wasm"), "ORT wasm MIME", type || "(缺失)");
  } else {
    add(isJavaScript(type), "ORT mjs MIME", type || "(缺失)");
  }
}

// 4. 分割模型 ---------------------------------------------------------------
if (skipModels) {
  add(true, "分割模型", "已跳过（--skip-models）");
} else {
  for (const model of manifest.models) {
    const url = new URL(`models/${model.fileName}`, base.href).href;
    const response = await probe(url);
    if (!response) continue;
    if (!isOk(response)) {
      fail(`模型 ${model.id}`, `${url} → HTTP ${response.status}`);
      continue;
    }
    const type = header(response, "content-type").toLowerCase();
    if (isHtml(type)) {
      fail(`模型 ${model.id}`, "返回了 HTML（被 SPA 回退或 404 页捕获），应返回 404 或模型文件");
      continue;
    }
    const encoding = header(response, "content-encoding");
    const length = Number(header(response, "content-length") ?? 0);
    if (!encoding && length > 0 && length !== model.byteLength) {
      fail(
        `模型 ${model.id} 大小`,
        `Content-Length=${length}，清单=${model.byteLength}；文件不匹配或清单未同步`,
      );
      continue;
    }
    add(
      true,
      `模型 ${model.id}`,
      `${(model.byteLength / 1024 / 1024).toFixed(1)} MB${encoding ? `（${encoding}）` : ""}`,
    );
  }
}

// 5. 示例图与安全上下文 -----------------------------------------------------
const sampleResponse = await probe(new URL("samples/heart.png", base.href).href);
if (sampleResponse) {
  add(
    isOk(sampleResponse) && header(sampleResponse, "content-type").toLowerCase().includes("image/png"),
    "示例图",
    `HTTP ${sampleResponse.status} · ${header(sampleResponse, "content-type") || "(无类型)"}`,
  );
}

if (base.protocol === "https:") {
  add(true, "安全上下文", "HTTPS（Cache Storage / SHA-256 校验 / WebGPU 可用）");
} else {
  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
  if (localHosts.has(base.hostname)) {
    add(true, "安全上下文", "localhost 本地验收，浏览器视为安全上下文");
  } else {
    warn(
      false,
      "安全上下文",
      "HTTP 非 localhost：Cache Storage 不可用（每次重新下载模型）、SHA-256 校验跳过；请上 HTTPS",
    );
  }
}

// 汇总 ----------------------------------------------------------------------
const failures = checks.filter((check) => !check.ok && !check.warning);
const warnings = checks.filter((check) => check.warning);
console.log("");
if (failures.length === 0 && warnings.length === 0) {
  console.log("验收通过：静态资源、响应头与模型均可用。");
} else if (failures.length === 0) {
  console.log(`验收通过，但有 ${warnings.length} 项警告（功能可用，性能或缓存可能降级）。`);
} else {
  console.log(`验收失败：${failures.length} 项失败，${warnings.length} 项警告。`);
}

if (failures.length > 0 || (strict && warnings.length > 0)) process.exitCode = 1;
