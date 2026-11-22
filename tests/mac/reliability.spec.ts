import { test, expect } from "@playwright/test";

test("a hidden study window stops polling and visibility does not resume paused speech", async ({ page }) => {
  let reads = 0, writes = 0, paused = false;
  await page.route("**/api/desktop/transcribe?*", route => {
    if (route.request().method() === "POST") writes++;
    else reads++;
    return route.fulfill({ json: {
      status: paused ? "paused" : "processing", stage: "Recognizing speech",
      message: paused ? "Subtitle preparation paused." : undefined,
    } });
  });
  await page.goto("/");
  await page.evaluate(() => window.eval('source={type:"youtube",id:"AAAAAAAAAAA"};beginTranscript()'));
  await expect.poll(() => reads).toBeGreaterThan(0);
  await page.evaluate(() => window.eval('immersedWindowVisibility(false)'));
  const before = reads;
  await page.waitForTimeout(1250);
  expect(reads).toBe(before);
  paused = true;
  await page.evaluate(() => window.eval('immersedWindowVisibility(true)'));
  await expect(page.getByRole("button", { name: "Resume subtitles" })).toBeVisible();
  expect(writes).toBe(1);
  await page.getByRole("button", { name: "Resume subtitles" }).click();
  await expect.poll(() => writes).toBe(2);
});

test("superseding a transcript request drops a delayed failure from the old video", async ({ page }) => {
  let receivedOld: () => void;
  let finishOld: () => void;
  const pendingOld = new Promise<void>(resolve => receivedOld = resolve);
  const delayedOld = new Promise<void>(resolve => finishOld = resolve);
  await page.route("**/api/desktop/transcribe?*", async route => {
    if (route.request().method() === "POST" || !route.request().url().includes("AAAAAAAAAAA")) {
      await route.fulfill({ json: { status: "ready" } });
      return;
    }
    receivedOld();
    await delayedOld;
    await route.fulfill({ status: 503, json: { error: "Obsolete failure" } }).catch(() => {});
  });
  await page.goto("/");
  await page.evaluate(() => window.eval('source={type:"youtube",id:"AAAAAAAAAAA"};beginTranscript()'));
  await pendingOld;
  await page.evaluate(() => window.eval('stopMedia();source={type:"youtube",id:"BBBBBBBBBBB"};beginTranscript()'));
  finishOld();
  await expect(page.locator("#status")).toHaveText("");
  await expect(page.getByRole("button", { name: "Retry subtitles" })).toBeHidden();
});

test("app update settings expose the direct release independently of Kotoba Atlas", async ({ page }) => {
  let checks = 0;
  await page.route("**/api/desktop/app-update?*", route => {
    const manual = route.request().url().includes("action=check");
    if (manual) checks++;
    return route.fulfill({ json: {
      version: "0.22.13", channel: "direct", supported: true, auto: false,
      status: manual ? "checked" : "idle", latest: manual ? "0.22.14" : null,
      available: manual, url: "https://github.com/Somamill/immersed-community/releases/tag/v0.22.14",
    } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByText("Installed version: 0.22.13")).toBeVisible();
  await expect(page.getByLabel("Automatically check for app updates")).not.toBeChecked();
  expect(checks).toBe(0);
  await page.getByRole("button", { name: "Check for Updates", exact: true }).click();
  await expect(page.getByRole("link", { name: "View Mac release" })).toHaveAttribute(
    "href", "https://github.com/Somamill/immersed-community/releases/tag/v0.22.14",
  );
  await expect(page.getByRole("heading", { name: "Kotoba Atlas" })).toBeVisible();
  expect(checks).toBe(1);
});
