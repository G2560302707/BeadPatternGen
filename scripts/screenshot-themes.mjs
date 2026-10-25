// 主题审查截图：对每套主题截首页整页图 → scripts/.shots/<id>.png
// 运行前先起 dev server：pnpm dev（默认 5173）
// 用法：node scripts/screenshot-themes.mjs [baseUrl]
/* eslint-disable no-undef -- addInitScript 回调在浏览器里执行，引用的是浏览器全局 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "scripts", ".shots");
mkdirSync(outDir, { recursive: true });

const base = process.argv[2] ?? "http://127.0.0.1:5173";
const THEMES = ["sakura", "taro", "matcha", "soda", "luna", "cloud", "paper", "pixel"];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
for (const theme of THEMES) {
  await page.addInitScript(
    ([id]) => {
      localStorage.setItem("bead.theme", id);
    },
    [theme],
  );
  await page.goto(`${base}/`, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(outDir, `${theme}.png`), fullPage: true });
  console.log(`✓ ${theme}.png`);
}
await browser.close();
console.log(`截图完成 → ${outDir}`);
