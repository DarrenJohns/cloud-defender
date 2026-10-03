import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/** Collects page errors and console errors so each test can assert the game ran cleanly. */
function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function startGame(page: Page, seed = 1): Promise<void> {
  await page.goto(`/?seed=${seed}`);
  // The title screen only accepts input once every model has loaded.
  await expect(page.locator("#splash")).toHaveClass(/is-ready/, { timeout: 45_000 });
  await page.keyboard.press("Enter");
  await expect(page.locator("body")).toHaveAttribute("data-game", "playing");
}

test.describe("Cloud Defender", () => {
  test("loads the title screen and starts a game", async ({ page }) => {
    const errors = trackErrors(page);
    await startGame(page);

    await expect(page.locator("#splash")).toBeHidden();
    await expect(page.locator("#game canvas")).toBeVisible();
    await expect(page.locator("#level")).toHaveText("01");
    await expect(page.locator("#score")).toHaveText("00000");
    await expect(page.locator("#lives")).toHaveAttribute("data-lives", "3");
    await expect(page.locator("#lives img")).toHaveCount(3);
    await expect(page.locator("#asset-notice")).toBeHidden();
    expect(errors).toEqual([]);
  });

  test("scores by shooting aliens", async ({ page }) => {
    await startGame(page);
    await page.keyboard.down("Space");
    await expect
      .poll(async () => Number(await page.locator("#score").textContent()), { timeout: 45_000 })
      .toBeGreaterThan(0);
    await page.keyboard.up("Space");
  });

  test("pauses and resumes from the keyboard and the panel", async ({ page }) => {
    await startGame(page);

    await page.keyboard.press("KeyP");
    await expect(page.locator("body")).toHaveAttribute("data-game", "paused");
    await expect(page.locator("#pause-panel")).toBeVisible();

    await page.locator("#resume-button").click();
    await expect(page.locator("body")).toHaveAttribute("data-game", "playing");
    await expect(page.locator("#pause-panel")).toBeHidden();
  });

  test("pauses automatically when the tab is hidden", async ({ page }) => {
    await startGame(page);

    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await expect(page.locator("body")).toHaveAttribute("data-game", "paused");
    await expect(page.locator("#pause-panel")).toBeVisible();
  });

  test("remembers the mute setting", async ({ page }) => {
    await startGame(page);

    await page.keyboard.press("KeyM");
    await expect(page.locator("#mute-button")).toHaveAttribute("data-state", "muted");

    await startGame(page, 2);
    await expect(page.locator("#mute-button")).toHaveAttribute("data-state", "muted");
    await page.locator("#mute-button").click();
    await expect(page.locator("#mute-button")).toHaveAttribute("data-state", "sound");
  });

  test("shows the end panel on game over and restarts to the title", async ({ page }) => {
    await startGame(page);

    // T is the built-in shortcut that ends the run immediately.
    await page.keyboard.press("KeyT");
    await expect(page.locator("body")).toHaveAttribute("data-game", "gameover");
    await expect(page.locator("#end-panel")).toBeVisible();
    await expect(page.locator("#end-accuracy")).toHaveText(/\d+%/);

    await page.locator("#restart-button").click();
    await expect(page.locator("#splash")).toBeVisible();
    await expect(page.locator("body")).toHaveAttribute("data-game", "splash");
    await expect(page.locator("#score")).toHaveText("00000");
  });
});
