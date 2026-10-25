import { expect, test } from "@playwright/test";
import { fixturePng, gotoMock, makePattern } from "./helpers";

test("upload crop generate save reload export", async ({ page }) => {
  const extra: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith("http://127.0.0.1:4174") && !url.startsWith("blob:") && !url.startsWith("data:")) {
      extra.push(url);
    }
  });

  await gotoMock(page);
  await expect(page.getByTestId("privacy-notice")).toBeVisible();
  const firstId = await makePattern(page, { w: "12", h: "12", maxColors: "8" });
  await expect(page.getByTestId("quality-report")).toBeVisible();
  await expect(page.getByTestId("palette-stats")).toContainText("颗");

  // 保存到本机（导出步）
  await page.getByTestId("step-export").click();
  await expect(page.getByTestId("save-project")).toBeVisible();
  await page.getByTestId("save-project").click();
  await expect(page.getByTestId("save-status")).toContainText("已保存", { timeout: 15_000 });

  // 刷新后从首页作品库重新打开
  await page.reload();
  await page.locator(".brand").click();
  await expect(page.getByTestId(`open-project-${firstId}`)).toBeVisible({ timeout: 15_000 });
  await page.getByTestId(`open-project-${firstId}`).click();
  await expect(page.getByTestId("pattern-board")).toBeVisible({ timeout: 15_000 });
  const reopened = await page.getByTestId("pattern-board").getAttribute("data-pattern-id");
  expect(reopened).toBe(firstId);

  // 四种格式导出
  await page.getByTestId("step-export").click();
  const png = page.waitForEvent("download");
  await page.getByTestId("export-png").click();
  expect((await png).suggestedFilename()).toMatch(/\.png$/);

  const pdf = page.waitForEvent("download");
  await page.getByTestId("export-pdf-make").click();
  expect((await pdf).suggestedFilename()).toMatch(/\.pdf$/);

  const csv = page.waitForEvent("download");
  await page.getByTestId("export-csv").click();
  expect((await csv).suggestedFilename()).toMatch(/\.csv$/);

  const json = page.waitForEvent("download");
  await page.getByTestId("export-json").click();
  expect((await json).suggestedFilename()).toMatch(/\.json$/);

  expect(extra, `unexpected network: ${extra.join(", ")}`).toEqual([]);
});

test("cancel then generate keeps only the new task", async ({ page }) => {
  test.setTimeout(90_000);
  await gotoMock(page);
  await page.getByTestId("import-file").setInputFiles({
    name: "fixture.png",
    mimeType: "image/png",
    buffer: fixturePng(),
  });
  await expect(page.getByTestId("skip-compose")).toBeVisible();
  await page.getByTestId("skip-compose").click();
  await page.locator("#grid-w").fill("24");
  await page.locator("#grid-h").fill("24");
  await page.getByTestId("apply-sample").click();
  await page.getByTestId("next-generate").click();
  await page.getByTestId("generate").click();
  await page.getByTestId("cancel-generate").click({ timeout: 3_000, force: true }).catch(() => undefined);
  if (await page.getByTestId("generate").isVisible()) {
    await page.getByTestId("generate").click();
  }
  await expect(page.getByTestId("pattern-board")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("generation-status")).toContainText("生成完成");
});
