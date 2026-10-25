import { expect, test } from "@playwright/test";
import {
  assertNoExtraNetwork,
  fixturePng,
  gotoMock,
  importPng,
  waitForMainSubject,
} from "./helpers";

test("compose main path: import detect compose generate export", async ({ page }) => {
  test.setTimeout(90_000);
  const extra = assertNoExtraNetwork(page);
  await gotoMock(page);
  await importPng(page);

  await expect(page.getByTestId("import-phase")).toHaveAttribute("data-phase", "detecting");
  await expect(page.getByTestId("subject-progress")).toBeVisible();
  await waitForMainSubject(page);
  await expect(page.getByTestId("composition-workbench")).toBeVisible();

  await page.getByTestId("compose-scale-90").click();
  await page.getByTestId("compose-pos-right").click();
  await page.locator("#compose-grid-w").fill("12");
  await page.locator("#compose-grid-h").fill("12");
  await page.getByTestId("confirm-compose").click();

  // 确认构图后自动开始生成，完成时自动进入精修页
  await expect(page.getByTestId("pattern-board")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("generation-status")).toContainText("生成完成");

  await page.getByTestId("step-export").click();
  const png = page.waitForEvent("download");
  await page.getByTestId("export-png").click();
  expect((await png).suggestedFilename()).toMatch(/\.png$/);

  expect(extra(), `unexpected network: ${extra().join(", ")}`).toEqual([]);
});

test("no subject shows retry and skip", async ({ page }) => {
  await gotoMock(page, "mock-scenario=empty");
  await importPng(page);
  await expect(page.getByTestId("subject-error")).toHaveAttribute("data-code", "E_NO_SUBJECT", {
    timeout: 15_000,
  });
  await expect(page.getByTestId("subject-manual-box")).toBeVisible();
  await expect(page.getByTestId("redetect-subject")).toBeEnabled();
  await expect(page.getByTestId("skip-compose")).toBeVisible();
  await expect(page.getByTestId("confirm-compose")).toBeDisabled();
});

test("detect fail then retry succeeds", async ({ page }) => {
  await gotoMock(page, "mock-scenario=fail");
  await importPng(page);
  await expect(page.getByTestId("subject-error")).toHaveAttribute("data-code", "E_INFERENCE_FAILED", {
    timeout: 15_000,
  });

  await page.evaluate(() => {
    (window as Window & {
      __beadMockDetect?: { setMockDetectScenario: (value: string) => void };
    }).__beadMockDetect?.setMockDetectScenario("ok");
  });
  await page.getByTestId("redetect-subject").click();
  await expect(page.getByTestId("subject-progress")).toBeVisible();
  await waitForMainSubject(page);
  await expect(page.getByTestId("confirm-compose")).toBeEnabled();
});

test("multi subject requires choosing a candidate", async ({ page }) => {
  await gotoMock(page, "mock-scenario=multi");
  await importPng(page);
  await expect(page.getByTestId("subject-multi-hint")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("subject-candidate-mock-alt")).toBeVisible();
  await page.getByTestId("subject-candidate-mock-alt").click();
  await expect(page.getByTestId("confirm-compose")).toBeEnabled();
  await expect(page.getByTestId("composition-canvas")).toBeVisible();
});

test("overflow warning and apply suggestion", async ({ page }) => {
  await gotoMock(page);
  await importPng(page);
  await waitForMainSubject(page);

  await page.evaluate(() => {
    type Store = {
      getState: () => {
        patchCompositionParams: (patch: { subjectScale: number; offsetX: number; offsetY: number }) => void;
      };
    };
    (window as Window & { __beadWorkspace?: Store }).__beadWorkspace?.getState().patchCompositionParams({
      subjectScale: 0.9,
      offsetX: 0.9,
      offsetY: 0,
    });
  });

  await expect(page.getByTestId("overflow-warning")).toBeVisible();
  await page.getByTestId("apply-overflow-suggestion").click();
  await expect(page.getByTestId("overflow-warning")).toBeHidden();
});

test("import failure: resolution too low", async ({ page }) => {
  await gotoMock(page);
  await page.getByTestId("import-file").setInputFiles({
    name: "tiny.png",
    mimeType: "image/png",
    buffer: fixturePng(8, 8),
  });
  await expect(page.getByTestId("import-error")).toHaveAttribute("data-kind", "resolution-too-low");
});

test("reimporting the same file restores persisted subjects", async ({ page }) => {
  await gotoMock(page);
  await importPng(page);
  await waitForMainSubject(page);
  await page.reload();
  await page.waitForFunction(
    () => Boolean((window as Window & { __beadMockDetect?: unknown }).__beadMockDetect),
  );
  // 刷新后落在守卫页，先回导入步再导入同一张图
  await page.getByTestId("step-import").click();
  await expect(page.getByTestId("import-file")).toBeVisible();
  await importPng(page);
  await expect(page.getByTestId("subject-candidate-mock-main")).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId("composition-canvas")).toBeVisible();
});

test("redetect after success is reachable", async ({ page }) => {
  await gotoMock(page);
  await importPng(page);
  await waitForMainSubject(page);
  await page.getByTestId("redetect-subject").click();
  await expect(page.getByTestId("subject-progress")).toBeVisible();
  await waitForMainSubject(page);
});
