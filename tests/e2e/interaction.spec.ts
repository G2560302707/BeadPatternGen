import { expect, test } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { gotoMock, makePattern } from "./helpers";

async function generatePattern(page: import("@playwright/test").Page, w: string, h: string) {
  await gotoMock(page);
  await makePattern(page, { w, h });
}

async function currentZoom(page: import("@playwright/test").Page): Promise<string> {
  return (await page.locator(".pattern-toolbar__scale").textContent()) ?? "";
}

/** 当前画笔色号（吸管取色后即格子颜色）。 */
async function paintSwatchCode(page: import("@playwright/test").Page): Promise<string> {
  return (await page.locator(".pattern-toolbar__paint code").innerText()) ?? "";
}

test("zoom survives eyedrop, palette click, fill and undo", async ({ page }) => {
  await generatePattern(page, "32", "32");

  await page.locator("button", { hasText: "放大" }).click();
  await page.locator("button", { hasText: "放大" }).click();
  const zoomed = await currentZoom(page);
  expect(zoomed).not.toBe("1×");

  const stage = page.locator(".pattern-stage");
  // 新版是可滚动文档：每次滚动（如点色卡）都会移动舞台，鼠标坐标必须现取现用。
  const stageBox = async () => {
    const box = (await stage.boundingBox())!;
    return {
      redSide: { x: box.x + box.width * 0.3, y: box.y + box.height * 0.5 },
      whiteSide: { x: box.x + box.width * 0.7, y: box.y + box.height * 0.5 },
    };
  };

  // 吸色：点击画布格子取色并自动切回画笔（取色即用），视图不得弹回。
  await page.getByTestId("edit-tool-eyedrop").click();
  const { redSide } = await stageBox();
  await page.mouse.click(redSide.x, redSide.y);
  await expect(page.locator(".pattern-toolbar__paint")).toBeVisible();
  expect(await currentZoom(page)).toBe(zoomed);

  // 点色卡选色：只换颜色，不偷换工具（吸管取色后已停在画笔）、不重置视图。
  await page.locator(".usage-row").first().click();
  const toolClass = await page.getByTestId("edit-tool-paint").getAttribute("class");
  expect(toolClass).toContain("btn--primary");
  expect(await currentZoom(page)).toBe(zoomed);

  // 框选跨色区域后填充：编辑操作不得重置视图（旧实现在这里 fitView 弹回）。
  await page.getByTestId("edit-tool-select-rect").click();
  const sides = await stageBox();
  await page.mouse.move(sides.redSide.x, sides.redSide.y);
  await page.mouse.down();
  await page.mouse.move(sides.whiteSide.x, sides.whiteSide.y, { steps: 8 });
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

  // 导出在独立的导出步页面
  await page.getByTestId("step-export").click();
  await expect(page.getByTestId("export-pdf-make")).toBeVisible();

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

test("lasso keeps up with fast strokes and fills the looped area", async ({ page }) => {
  await generatePattern(page, "32", "32");
  await page.getByTestId("edit-tool-select-lasso").click();
  const box = (await page.locator(".pattern-stage").boundingBox())!;
  // 快速划一个圈：每段只有 3 个中间事件、跨多格，旧实现（只在进入新格子时记点）
  // 会漏采样导致选区缺块甚至为空。
  const cx = box.x + box.width * 0.5;
  const cy = box.y + box.height * 0.5;
  const rx = box.width * 0.15;
  const ry = box.height * 0.25;
  await page.mouse.move(cx - rx, cy - ry);
  await page.mouse.down();
  await page.mouse.move(cx + rx, cy - ry, { steps: 3 });
  await page.mouse.move(cx + rx, cy + ry, { steps: 3 });
  await page.mouse.move(cx - rx, cy + ry, { steps: 3 });
  await page.mouse.move(cx - rx, cy - ry, { steps: 3 });
  await page.mouse.up();
  await expect(page.getByTestId("edit-fill")).toBeEnabled();

  // 圈住的区域应覆盖多个格子：填充一次，撤销栈里应有这条命令。
  await page.getByTestId("edit-fill").click();
  await expect(page.getByTestId("edit-undo")).toBeEnabled();
});

test("paint click toggles: second click reverts to generated color", async ({ page }) => {
  await generatePattern(page, "32", "32");
  const box = (await page.locator(".pattern-stage").boundingBox())!;
  const point = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.5 };

  // 吸管读原色（读完自动停在画笔）。
  await page.getByTestId("edit-tool-eyedrop").click();
  await page.mouse.click(point.x, point.y);
  const original = await paintSwatchCode(page);

  // 从色卡选一个不同的颜色并上色。
  const codes = await page.locator(".usage-row code").allInnerTexts();
  const different = codes.find((code) => code !== original);
  expect(different).toBeTruthy();
  await page.locator(".usage-row", { hasText: different! }).first().click();
  await page.mouse.click(point.x, point.y);
  await page.getByTestId("edit-tool-eyedrop").click();
  await page.mouse.click(point.x, point.y);
  expect(await paintSwatchCode(page)).toBe(different);

  // 吸管读后已自动回画笔：再点一下 = 取消，恢复生成色。
  await page.mouse.click(point.x, point.y);
  await page.getByTestId("edit-tool-eyedrop").click();
  await page.mouse.click(point.x, point.y);
  expect(await paintSwatchCode(page)).toBe(original);
});

test("3×3 brush paints a wider area in one click", async ({ page }) => {
  await generatePattern(page, "32", "32");
  await page.getByTestId("brush-size-3").click();
  const box = (await page.locator(".pattern-stage").boundingBox())!;
  // 工具栏倍率 = 每格屏幕像素，用它定位相邻格。
  const cell = parseFloat((await page.locator(".pattern-toolbar__scale").innerText()) ?? "0");
  expect(cell).toBeGreaterThan(5);
  const point = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.5 };
  const right = { x: point.x + cell, y: point.y };
  const down = { x: point.x, y: point.y + cell };

  // 低频色做标记、高频色做哨兵：擦空 3×3 再一键涂上，
  // 之后中心 / 右邻 / 下邻吸管读取都必须是标记色（1×1 笔刷会在邻居上读到哨兵色）。
  const codes = await page.locator(".usage-row code").allInnerTexts();
  const rare = codes[codes.length - 1]!;
  const sentinel = codes[0]!;
  expect(sentinel).not.toBe(rare);
  await page.locator(".usage-row", { hasText: rare }).first().click();

  await page.getByTestId("edit-tool-erase").click();
  await page.mouse.click(point.x, point.y);
  await page.getByTestId("edit-tool-paint").click();
  await page.mouse.click(point.x, point.y);

  const readCell = async (p: { x: number; y: number }) => {
    await page.locator(".usage-row", { hasText: sentinel }).first().click();
    await page.getByTestId("edit-tool-eyedrop").click();
    await page.mouse.click(p.x, p.y); // 空格不改变色样，有色则吸成该色
    return paintSwatchCode(page);
  };
  expect(await readCell(point)).toBe(rare);
  expect(await readCell(right)).toBe(rare);
  expect(await readCell(down)).toBe(rare);
});

test("keyboard shortcuts switch tools and undo", async ({ page }) => {
  await generatePattern(page, "32", "32");
  await page.keyboard.press("e");
  await expect(page.getByTestId("edit-tool-erase")).toHaveClass(/btn--primary/);
  await page.keyboard.press("b");
  await expect(page.getByTestId("edit-tool-paint")).toHaveClass(/btn--primary/);
  await page.keyboard.press("i");
  await expect(page.getByTestId("edit-tool-eyedrop")).toHaveClass(/btn--primary/);
  await page.keyboard.press("b");

  const box = (await page.locator(".pattern-stage").boundingBox())!;
  await page.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.5);
  await expect(page.getByTestId("edit-undo")).toBeEnabled();
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("edit-undo")).toBeDisabled();
});
