import { expect, test } from "@playwright/test";
import { encode } from "fast-png";
import { gotoMock } from "./helpers";

/** 合成一张简单的 Q 版风格测试图：蓝天背景 + 圆脸 + 蓝发块，便于目检对照参考图纸。 */
function chibiPng(size = 256): Buffer {
  const data = new Uint8Array(size * size * 4);
  const cx = size / 2;
  const cy = size / 2 + 20;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      // 背景浅蓝天空
      let r = 205;
      let g = 232;
      let b = 255;
      // 头发大圆（深蓝）
      const dHair = Math.hypot(x - cx, y - cy - 10);
      if (dHair < 86) {
        r = 46; g = 78; b = 178;
        if (dHair > 70) { r = 30; g = 52; b = 128; }
      }
      // 脸（肤色圆）
      const dFace = Math.hypot(x - cx, y - cy - 14);
      if (dFace < 52) {
        r = 250; g = 224; b = 198;
      }
      // 眼睛
      const dEyeL = Math.hypot(x - cx - 22, y - cy);
      const dEyeR = Math.hypot(x - cx + 22, y - cy);
      if (dEyeL < 10 || dEyeR < 10) {
        r = 34; g = 44; b = 92;
        if (dEyeL < 5 || dEyeR < 5) { r = 120; g = 190; b = 255; }
      }
      // 腮红
      const dBlushL = Math.hypot(x - cx - 34, y - cy + 14);
      const dBlushR = Math.hypot(x - cx + 34, y - cy + 14);
      if (dBlushL < 8 || dBlushR < 8) {
        r = 244; g = 160; b = 160;
      }
      // 身体（白色围裙）
      if (y > cy + 66 && y < size - 8 && Math.abs(x - cx) < 40 - (size - y) * 0.05) {
        r = 248; g = 248; b = 252;
      }
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return Buffer.from(encode({ width: size, height: size, data, channels: 4, depth: 8 }));
}

test("export share card for visual acceptance", async ({ page }) => {
  test.setTimeout(120_000);
  await gotoMock(page);
  await page.getByTestId("import-file").setInputFiles({
    name: "chibi.png",
    mimeType: "image/png",
    buffer: chibiPng(),
  });
  await expect(page.getByTestId("skip-compose")).toBeVisible();
  await page.getByTestId("skip-compose").click();
  await expect(page.getByTestId("crop-controls")).toBeVisible();
  await page.locator("#grid-w").fill("52");
  await page.locator("#grid-h").fill("52");
  await page.getByTestId("crop-auto").click();
  await page.getByTestId("apply-sample").click();
  await expect(page.getByText("采样完成")).toBeVisible();
  await page.locator("#max-colors").fill("18");
  await page.getByTestId("generate").click();
  await expect(page.getByTestId("pattern-board")).toBeVisible({ timeout: 60_000 });

  const share = page.waitForEvent("download");
  await page.getByTestId("export-share-card").click();
  const download = await share;
  expect(download.suggestedFilename()).toMatch(/-share\.png$/);
  await download.saveAs("test-results/share-card-52.png");
});
