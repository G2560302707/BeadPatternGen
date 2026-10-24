import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { fixturePng, gotoMock } from "./helpers";

async function generatePattern(page: import("@playwright/test").Page, w: string, h: string) {
  await gotoMock(page);
  await page.getByTestId("import-file").setInputFiles({
    name: "fixture.png",
    mimeType: "image/png",
    buffer: fixturePng(),
  });
  await page.getByTestId("skip-compose").click();
  await page.locator("#grid-w").fill(w);
  await page.locator("#grid-h").fill(h);
  await page.getByTestId("crop-auto").click();
  await page.getByTestId("apply-sample").click();
  await page.getByText("采样完成").waitFor();
  await page.getByTestId("generate").click();
  await expect(page.getByTestId("pattern-board")).toBeVisible({ timeout: 60_000 });
}

async function currentZoom(page: import("@playwright/test").Page): Promise<string> {
  return (await page.locator(".pattern-toolbar__scale").textContent()) ?? "";
}

test("zoom survives eyedrop, palette click, fill and undo", async ({ page }) => {
  await generatePattern(page, "32", "32");

  await page.locator("button", { hasText: "放大" }).click();
  await page.locator("button", { hasText: "放大" }).click();
  const zoomed = await currentZoom(page);
  expect(zoomed).not.toBe("1×");

  const stage = page.locator(".pattern-stage");
  const box = (await stage.boundingBox())!;
  // fixture 左半红、右半白：框选从左 30% 拖到右 70% 必然跨两种颜色，
  // 填充后必有实际改动，撤销可用。
  const redSide = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.5 };
  const whiteSide = { x: box.x + box.width * 0.7, y: box.y + box.height * 0.5 };

  // 吸色：点击画布格子，视图不得弹回。
  await page.getByTestId("edit-tool-eyedrop").click();
  await page.mouse.click(redSide.x, redSide.y);
  await expect(page.locator(".pattern-toolbar__paint")).toBeVisible();
  expect(await currentZoom(page)).toBe(zoomed);

  // 点色卡选色：只换颜色，不偷换工具、不重置视图。
  await page.locator(".usage-row").first().click();
  const toolClass = await page.getByTestId("edit-tool-eyedrop").getAttribute("class");
  expect(toolClass).toContain("btn--primary");
  expect(await currentZoom(page)).toBe(zoomed);

  // 框选跨色区域后填充：编辑操作不得重置视图（旧实现在这里 fitView 弹回）。
  await page.getByTestId("edit-tool-select-rect").click();
  await page.mouse.move(redSide.x, redSide.y);
  await page.mouse.down();
  await page.mouse.move(whiteSide.x, whiteSide.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId("edit-fill")).toBeEnabled();
  expect(await currentZoom(page)).toBe(zoomed);

  await page.getByTestId("edit-fill").click();
  await expect(page.getByTestId("edit-undo")).toBeEnabled();
  expect(await currentZoom(page)).toBe(zoomed);

  // 撤销一次编辑，视图同样保持。
  await page.getByTestId("edit-undo").click();
  expect(await currentZoom(page)).toBe(zoomed);
});

test("oversized chart exports a single-page make PDF plus legend", async ({ page }) => {
  await generatePattern(page, "200", "80");

  // 200 列超过 A4 整档容量（5pt 下 98 列），默认单页模式应整图一页。
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("export-pdf-make").click(),
  ]);
  const path = await download.path();
  expect(path, "download should land on disk").toBeTruthy();
  const doc = await PDFDocument.load(await readFile(path!));
  // 1 页图纸 + 1 页色表。
  expect(doc.getPageCount()).toBe(2);

  // 关闭色表页后只剩图纸单页。
  await page.getByTestId("pdf-include-legend").uncheck();
  const [download2] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("export-pdf-make").click(),
  ]);
  const path2 = await download2.path();
  const doc2 = await PDFDocument.load(await readFile(path2!));
  expect(doc2.getPageCount()).toBe(1);

  // 关闭单页缩放回到分页：图纸页数应大于 1（切片分页）。
  await page.getByTestId("pdf-include-legend").check();
  await page.getByTestId("pdf-fit-single-page").uncheck();
  const [download3] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("export-pdf-make").click(),
  ]);
  const path3 = await download3.path();
  const doc3 = await PDFDocument.load(await readFile(path3!));
  expect(doc3.getPageCount()).toBeGreaterThan(2);
});
