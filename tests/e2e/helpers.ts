import { encode } from "fast-png";
import { expect, type Page } from "@playwright/test";

export const MOCK_HOME = "/?mock-detection=1";

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

export async function gotoMock(page: Page, query = ""): Promise<void> {
  const extra = query.startsWith("&") || query.startsWith("?") ? query.replace(/^[?&]/, "&") : query ? `&${query}` : "";
  await page.goto(`${MOCK_HOME}${extra}`);
  await page.waitForFunction(() => Boolean((window as Window & { __beadMockDetect?: unknown }).__beadMockDetect));
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
