import { decode } from "fast-png";
import { expect, test, type Page } from "@playwright/test";
import { gotoMock, makePattern } from "./helpers";

/**
 * R1 · 原图对照条：新生成可用；刷新（草稿恢复）与重开项目后依然可用。
 *
 * 断言用「舞台截图逐像素差分」而不是画布缓冲区检查：
 * 缓冲区有内容不代表图层真的叠在图纸上面（曾经被 CSS 文档流布局
 * 静默裁掉，缓冲区检查全是假阴性）。
 */

async function stageShot(page: Page): Promise<Buffer> {
  return page.locator(".pattern-stage").screenshot();
}

function diffPixels(a: Buffer, b: Buffer, tolerance = 12): number {
  const left = decode(a);
  const right = decode(b);
  expect(left.width).toBe(right.width);
  expect(left.height).toBe(right.height);
  let count = 0;
  for (let i = 0; i < left.data.length; i += 4) {
    if (
      Math.abs((left.data[i] ?? 0) - (right.data[i] ?? 0)) > tolerance ||
      Math.abs((left.data[i + 1] ?? 0) - (right.data[i + 1] ?? 0)) > tolerance ||
      Math.abs((left.data[i + 2] ?? 0) - (right.data[i + 2] ?? 0)) > tolerance
    ) {
      count += 1;
    }
  }
  return count;
}

async function assertCompareWorks(page: Page): Promise<void> {
  const slider = page.locator(".compare-slider input[type=range]");
  await expect(slider).toBeVisible();

  await slider.fill("0");
  await page.waitForTimeout(250);
  const at0 = await stageShot(page);
  // 5%：边界必须落在图纸矩形内（网格相对映射），左侧头几列被原图盖住。
  await slider.fill("5");
  await page.waitForTimeout(250);
  const at5 = await stageShot(page);
  // 100%：整张图纸被原图覆盖。
  await slider.fill("100");
  await page.waitForTimeout(250);
  const at100 = await stageShot(page);

  // 满对照：网格线、格子纹理都被原图替换，差异必然成千上万。
  expect(diffPixels(at0, at100)).toBeGreaterThan(5000);
  // 低对照：边界已进入图纸（若按舞台宽度映射，居中网格下 5% 毫无变化）。
  expect(diffPixels(at0, at5)).toBeGreaterThan(100);
}

async function paintOneCell(page: Page): Promise<void> {
  await page.getByTestId("edit-tool-paint").click();
  const box = (await page.locator(".pattern-stage").boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
}

test("compare slider paints original in fresh session", async ({ page }) => {
  await gotoMock(page);
  await makePattern(page, { w: "32", h: "32" });
  await assertCompareWorks(page);
});

test("compare survives reload via draft restore", async ({ page }) => {
  await gotoMock(page);
  await makePattern(page, { w: "32", h: "32" });
  await paintOneCell(page);
  await page.waitForTimeout(2000); // 等自动保存（1.2s 防抖 + IndexedDB 写入）
  await page.reload();
  await expect(page.getByTestId("pattern-board")).toBeVisible({ timeout: 15_000 });
  await assertCompareWorks(page);
});

test("compare works after reopening saved project", async ({ page }) => {
  await gotoMock(page);
  await makePattern(page, { w: "32", h: "32" });
  await paintOneCell(page);
  await page.getByTestId("step-export").click();
  await page.getByTestId("save-project").click();
  await expect(page.getByTestId("save-status")).toContainText("已保存", { timeout: 15_000 });
  await page.goto("/#/");
  await expect(page.getByTestId("project-list")).toBeVisible();
  await page.locator('[data-testid^="open-project-"]').first().click();
  await expect(page.getByTestId("pattern-board")).toBeVisible({ timeout: 15_000 });
  await assertCompareWorks(page);
});
