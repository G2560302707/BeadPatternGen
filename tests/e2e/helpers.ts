import { encode } from "fast-png";
import { expect, type Page } from "@playwright/test";

export const MOCK_HOME = "/?mock-detection=1";
/** 测试默认落在导入步，直接可以 setInputFiles。 */
export const DEFAULT_ROUTE = "/make/import";

export function fixturePng(width = 32, height = 32): Buffer {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const left = x < width / 2;
      data[i] = left ? 203 : 234;
      data[i + 1] = left ? 53 : 238;
      data[i + 2] = left ? 49 : 243;
      data[i + 3] = 255;
    }
  }
  return Buffer.from(encode({ width, height, data, channels: 4, depth: 8 }));
}

export async function gotoMock(page: Page, query = "", route = DEFAULT_ROUTE): Promise<void> {
  const extra = query.startsWith("&") || query.startsWith("?") ? query.replace(/^[?&]/, "&") : query ? `&${query}` : "";
  await page.goto(`${MOCK_HOME}${extra}#${route}`);
  await page.waitForFunction(() => Boolean((window as Window & { __beadMockDetect?: unknown }).__beadMockDetect));
  await expect(page.getByTestId("import-file")).toBeVisible();
}

export async function importPng(page: Page, buffer = fixturePng()): Promise<void> {
  await page.getByTestId("import-file").setInputFiles({
    name: "fixture.png",
    mimeType: "image/png",
    buffer,
  });
}

export async function waitForMainSubject(page: Page): Promise<void> {
  await expect(page.getByTestId("subject-candidate-mock-main")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("composition-canvas")).toBeVisible();
}

/**
 * 全流程走查：导入 → （跳过构图）→ 画布采样 → 调色生成 → 精修画布出现。
 * 返回图纸 id（pattern-board 的 data-pattern-id）。
 */
export async function makePattern(
  page: Page,
  options: { w?: string; h?: string; maxColors?: string; skipCompose?: boolean } = {},
): Promise<string> {
  const { w = "32", h = "32", maxColors, skipCompose = true } = options;
  await importPng(page);
  if (skipCompose) {
    await expect(page.getByTestId("skip-compose")).toBeVisible();
    await page.getByTestId("skip-compose").click();
  }
  await expect(page.getByTestId("crop-controls")).toBeVisible();
  await page.locator("#grid-w").fill(w);
  await page.locator("#grid-h").fill(h);
  await page.getByTestId("crop-auto").click();
  await page.getByTestId("apply-sample").click();
  await page.getByText("采样完成").waitFor();
  await page.getByTestId("next-generate").click();
  if (maxColors) {
    await page.locator("#max-colors").fill(maxColors);
  }
  await page.getByTestId("generate").click();
  await expect(page.getByTestId("pattern-board")).toBeVisible({ timeout: 60_000 });
  const id = await page.getByTestId("pattern-board").getAttribute("data-pattern-id");
  expect(id).toBeTruthy();
  return id as string;
}

export function assertNoExtraNetwork(page: Page): () => string[] {
  const extra: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith("http://127.0.0.1:4174") && !url.startsWith("blob:") && !url.startsWith("data:")) {
      extra.push(url);
    }
  });
  return () => extra;
}
