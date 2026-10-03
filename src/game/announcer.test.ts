import { describe, expect, it } from "vitest";
import { ALL_VOICE_LINES, AnnouncerQueue, VOICE_COOLDOWN_SECONDS, VOICE_MAX_WAIT_SECONDS, voicePriority, waveLine } from "./announcer";

describe("announcer", () => {
  it("calls get ready for the first formation and a generic warning after", () => {
    expect(waveLine(1)).toBe("start-game");
    expect(waveLine(2)).toBe("next-wave");
    expect(waveLine(25)).toBe("next-wave");
    expect(ALL_VOICE_LINES).toHaveLength(10);
    expect(new Set(ALL_VOICE_LINES).size).toBe(ALL_VOICE_LINES.length);
  });

  it("ranks game over above shield warnings above routine calls", () => {
    expect(voicePriority("game-over")).toBeGreaterThan(voicePriority("last-shield"));
    expect(voicePriority("last-shield")).toBeGreaterThan(voicePriority("shield-lost"));
    expect(voicePriority("shield-lost")).toBeGreaterThan(voicePriority("next-wave"));
  });

  it("plays when idle and queues an equal-priority line until the current one ends", () => {
    const queue = new AnnouncerQueue();
    expect(queue.request("wave-secured", 0)).toBe("play");
    queue.started("wave-secured", 0, 0.8);
    expect(queue.request("next-wave", 0.1)).toBe("queue");
    expect(queue.next(0.5)).toBeNull();
    expect(queue.next(0.9)).toBe("next-wave");
    expect(queue.next(0.9)).toBeNull();
  });

  it("lets a higher-priority line interrupt", () => {
    const queue = new AnnouncerQueue();
    queue.started("zero-day", 0, 1);
    expect(queue.request("last-shield", 0.2)).toBe("interrupt");
    queue.started("last-shield", 0.2, 1);
    expect(queue.request("game-over", 0.3)).toBe("interrupt");
  });

  it("keeps only the most important waiting line", () => {
    const queue = new AnnouncerQueue();
    queue.started("game-over", 0, 1);
    expect(queue.request("shield-lost", 0.1)).toBe("queue");
    expect(queue.request("zero-day", 0.2)).toBe("drop");
    expect(queue.next(1.1)).toBe("shield-lost");
  });

  it("drops repeats inside the cooldown and stale queued lines", () => {
    const queue = new AnnouncerQueue();
    queue.started("shield-lost", 0, 0.5);
    expect(queue.request("shield-lost", 1)).toBe("drop");
    expect(queue.request("shield-lost", VOICE_COOLDOWN_SECONDS + 0.01)).toBe("play");

    queue.started("wave-secured", 10, 5);
    expect(queue.request("next-wave", 10.1)).toBe("queue");
    expect(queue.next(10.1 + VOICE_MAX_WAIT_SECONDS + 5)).toBeNull();
  });

  it("forgets everything on reset", () => {
    const queue = new AnnouncerQueue();
    queue.started("game-over", 0, 1);
    queue.request("start-game", 0.1);
    queue.reset();
    expect(queue.isPlaying(0.2)).toBe(false);
    expect(queue.next(0.2)).toBeNull();
    expect(queue.request("game-over", 0.3)).toBe("play");
  });
});
