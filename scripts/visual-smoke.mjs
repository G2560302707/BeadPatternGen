// 视觉走查截图：首页 / 导入 / 生成页 × 樱粉与月夜主题（临时脚本，人工目检用）。
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = "http://127.0.0.1:4175";
mkdirSync("test-results/visual", { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 860 } });

async function shot(url, name, actions) {
  await page.goto(`${BASE}/#${url}`);
  await page.waitForTimeout(600);
  if (actions) await actions();
  await page.screenshot({ path: `test-results/visual/${name}.png`, fullPage: false });
  console.log(`✓ ${name}`);
}

await shot("/", "home-sakura");
await shot("/make/import", "import-sakura");
await page.getByTestId("theme-toggle").click();
await page.waitForTimeout(300);
await page.screenshot({ path: "test-results/visual/theme-menu.png" });
console.log("✓ theme-menu");
await page.getByText("月夜宫阙").click();
await page.waitForTimeout(400);
await shot("/make/import", "import-luna");
await page.getByTestId("theme-toggle").click();
await page.getByText("樱粉少女").click();

// 走到生成页需要先造一张图纸；直接用示例图 + 默认参数快走一遍
await page.getByTestId("sample-heart").click();
await page.waitForTimeout(1500);
await page.getByTestId("skip-compose").click();
await page.waitForTimeout(400);
await page.getByTestId("apply-sample").click();
await page.waitForTimeout(600);
await page.getByTestId("next-generate").click();
await page.waitForTimeout(400);
await page.screenshot({ path: "test-results/visual/generate-sakura.png" });
console.log("✓ generate-sakura");

// 手机宽度
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/#/make/import`);
await page.waitForTimeout(600);
await page.screenshot({ path: "test-results/visual/import-mobile.png" });
console.log("✓ import-mobile");

await browser.close();
console.log("视觉截图完成 → test-results/visual/");
