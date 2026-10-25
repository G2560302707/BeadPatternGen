import { expect, test } from "@playwright/test";

test("no requests besides this origin", async ({ page }) => {
  const leaked: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith("http://127.0.0.1:4174") && !url.startsWith("blob:") && !url.startsWith("data:")) {
      leaked.push(url);
    }
  });
  await page.goto("/#/make/import");
  await expect(page.getByTestId("privacy-notice")).toContainText("不会上传");
  await expect(page.getByTestId("privacy-notice")).toContainText("IndexedDB");
  expect(leaked).toEqual([]);
});
