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
  test("plays palette sounds when aliens launch bombs and hit a firewall", async ({ page }) => {
    const errors = trackErrors(page);
    await page.addInitScript(() => {
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof start>) {
        start.apply(this, args);
        if (this.playbackRate.value === Math.fround(0.72)) {
          document.documentElement.dataset.alienLaunchSound = "played";
        }
        if (this.playbackRate.value === Math.fround(0.88)) {
          document.documentElement.dataset.firewallImpactSound = "played";
        }
      };
    });
    await startGame(page);
    await expect(page.locator("html")).toHaveAttribute("data-alien-launch-sound", "played", { timeout: 45_000 });
    await expect(page.locator("html")).toHaveAttribute("data-firewall-impact-sound", "played", { timeout: 45_000 });
    expect(errors).toEqual([]);
  });

  test("decodes the four approved stereo gameplay clips", async ({ page }) => {
    await page.goto("/");
    const clips = await page.evaluate(async () => {
      const context = new AudioContext();
      try {
        return await Promise.all(
          ["player-cannon", "alien-destruction", "shield-loss", "shield-acquired"].map(async (name) => {
            const response = await fetch(`assets/sfx/${name}.mp3`);
            if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
            const buffer = await context.decodeAudioData(await response.arrayBuffer());
            let peak = 0;
            for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
              for (const sample of buffer.getChannelData(channel)) {
                if (!Number.isFinite(sample)) throw new Error(`${name}: non-finite sample`);
                peak = Math.max(peak, Math.abs(sample));
              }
            }
            return { name, channels: buffer.numberOfChannels, duration: buffer.duration, peak };
          }),
        );
      } finally {
        await context.close();
      }
    });
    for (const [index, duration] of [1.8, 4.2, 2.3, 2.8].entries()) {
      expect(clips[index]!.channels).toBe(2);
      expect(clips[index]!.duration).toBeCloseTo(duration, 1);
      expect(clips[index]!.peak).toBeGreaterThan(0.5);
      expect(clips[index]!.peak).toBeLessThan(1);
    }
  });

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

  test("showcases a shield, freezes combat and flies it into the HUD without exceeding three", async ({ page }) => {
    const errors = trackErrors(page);
    await startGame(page);
    await page.evaluate(() => {
      const award = document.getElementById("shield-award")!;
      award.dataset.starts = "0";
      new MutationObserver((records) => {
        for (const record of records) {
          if (record.attributeName === "hidden" && record.oldValue !== null && !award.hidden) {
            award.dataset.starts = String(Number(award.dataset.starts) + 1);
          }
        }
      }).observe(award, { attributes: true, attributeFilter: ["hidden"], attributeOldValue: true });
    });
    await page.keyboard.press("KeyS");
    await expect(page.locator("body")).toHaveAttribute("data-game", "shield-award");
    await expect(page.locator("#shield-award")).toBeVisible();
    await expect(page.locator("#shield-award")).toHaveText("");
    await expect(page.locator("#shield-award")).toHaveAttribute("data-phase", "showcase");
    await expect(page.locator("#lives img.is-arriving")).toHaveCount(1);
    await expect(page.locator("#lives")).toHaveAttribute("data-lives", "3");
    await page.keyboard.down("Space");
    await page.keyboard.press("KeyS");
    await page.waitForTimeout(700);
    await expect(page.locator("#score")).toHaveText("00000");
    await expect(page.locator("#lives img")).toHaveCount(3);
    await expect(page.locator("#shield-award")).toHaveAttribute("data-phase", "flight", { timeout: 5_000 });
    await expect(page.locator("#shield-award")).toBeHidden({ timeout: 5_000 });
    await expect(page.locator("body")).toHaveAttribute("data-game", "playing");
    await expect(page.locator("#lives img.is-arriving")).toHaveCount(0);
    await page.keyboard.up("Space");
    await page.keyboard.down("Space");
    await expect.poll(async () => Number(await page.locator("#score").textContent()), { timeout: 45_000 }).toBeGreaterThan(0);
    await page.keyboard.up("Space");
    await page.waitForTimeout(4_000);
    await expect(page.locator("#shield-award")).toHaveAttribute("data-starts", "1");
    await expect(page.locator("#shield-award")).toBeHidden();
    await page.keyboard.down("KeyS");
    await expect(page.locator("#shield-award")).toBeVisible();
    await expect(page.locator("#shield-award")).toBeHidden({ timeout: 8_000 });
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyS", repeat: true }));
    });
    await page.waitForTimeout(500);
    await expect(page.locator("#shield-award")).toBeHidden();
    await expect(page.locator("#shield-award")).toHaveAttribute("data-starts", "2");
    await expect(page.locator("#lives")).toHaveAttribute("data-lives", "3");
    await page.keyboard.up("KeyS");
    expect(errors).toEqual([]);
  });

  test("restart cancels a shield showcase and resets the HUD", async ({ page }) => {
    await startGame(page);
    await page.keyboard.press("KeyS");
    await expect(page.locator("#shield-award")).toBeVisible();
    await page.keyboard.press("KeyR");
    await expect(page.locator("#shield-award")).toBeHidden();
    await expect(page.locator("body")).toHaveAttribute("data-game", "splash");
    await expect(page.locator("#lives img.is-arriving")).toHaveCount(0);
    await expect(page.locator("#lives img")).toHaveCount(3);
    await page.keyboard.press("Enter");
    await page.keyboard.press("KeyS");
    await expect(page.locator("#shield-award")).toBeVisible();
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

  test("hides the idle cursor during gameplay and restores it for movement and menus", async ({ page }) => {
    await startGame(page);
    await page.mouse.move(100, 100);
    await expect(page.locator("body")).toHaveClass(/cursor-idle/, { timeout: 8_000 });
    await expect(page.locator("#game canvas")).toHaveCSS("cursor", "none");
    await page.mouse.move(150, 100);
    await expect(page.locator("body")).not.toHaveClass(/cursor-idle/);
    await expect(page.locator("body")).toHaveClass(/cursor-idle/, { timeout: 8_000 });
    await page.keyboard.press("KeyP");
    await expect(page.locator("body")).not.toHaveClass(/cursor-idle/);
    await page.waitForTimeout(2_200);
    await expect(page.locator("body")).not.toHaveClass(/cursor-idle/);
    await page.keyboard.press("KeyR");
    await expect(page.locator("body")).not.toHaveClass(/cursor-idle/);
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
