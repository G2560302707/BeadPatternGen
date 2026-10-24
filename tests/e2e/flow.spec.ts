import { expect, test } from "@playwright/test";
import { fixturePng, gotoMock } from "./helpers";

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
  await page.getByTestId("import-file").setInputFiles({
    name: "fixture.png",
    mimeType: "image/png",
    buffer: fixturePng(),
  });
  await expect(page.getByTestId("skip-compose")).toBeVisible();
  await page.getByTestId("skip-compose").click();
  await expect(page.getByTestId("crop-controls")).toBeVisible();
  await page.locator("#grid-w").fill("12");
  await page.locator("#grid-h").fill("12");
  await page.getByTestId("crop-auto").click();
  await page.getByTestId("apply-sample").click();
  await expect(page.getByText("采样完成")).toBeVisible();
  await page.locator("#max-colors").fill("8");
  await page.getByTestId("generate").click();
  await expect(page.getByTestId("pattern-board")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("quality-report")).toBeVisible();
  await expect(page.getByTestId("palette-stats")).toContainText("颗");
  const firstId = await page.getByTestId("pattern-board").getAttribute("data-pattern-id");
  expect(firstId).toBeTruthy();

  await page.getByTestId("save-project").click();
  await expect(page.getByTestId("save-status")).toContainText("已保存", { timeout: 15_000 });

  await page.reload();
  await expect(page.getByRole("button", { name: /打开 / })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /打开 / }).first().click();
  await expect(page.getByTestId("pattern-board")).toBeVisible({ timeout: 15_000 });
  const reopened = await page.getByTestId("pattern-board").getAttribute("data-pattern-id");
  expect(reopened).toBe(firstId);

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
  await page.getByTestId("generate").click();
  await page.getByTestId("cancel-generate").click({ timeout: 3_000, force: true }).catch(() => undefined);
  if (await page.getByTestId("generate").isVisible()) {
    await page.getByTestId("generate").click();
  }
  await expect(page.getByTestId("pattern-board")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("generation-status")).toContainText("生成完成");
});
