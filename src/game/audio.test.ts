import { afterEach, describe, expect, it, vi } from "vitest";
import { GameAudio } from "./audio";

function parameter() {
  return { value: 1, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
}

function node() {
  return {
    connect: vi.fn((destination: unknown) => destination),
    disconnect: vi.fn(),
    gain: parameter(), frequency: parameter(), Q: parameter(),
    threshold: parameter(), ratio: parameter(),
  };
}

async function setup(fail = false) {
  const sources: ReturnType<typeof sourceNode>[] = [];
  const oscillators: ReturnType<typeof sourceNode>[] = [];
  const gains: ReturnType<typeof node>[] = [];
  function sourceNode() {
    return { ...node(), buffer: null as unknown, playbackRate: parameter(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null };
  }
  const context = {
    state: "running", currentTime: 0, sampleRate: 10, destination: node(),
    createGain: () => { const gain = node(); gains.push(gain); return gain; },
    createDynamicsCompressor: node, createBiquadFilter: node,
    createOscillator: () => { const oscillator = sourceNode(); oscillators.push(oscillator); return oscillator; },
    createBuffer: () => ({ getChannelData: () => new Float32Array(10) }),
    createBufferSource: () => { const source = sourceNode(); sources.push(source); return source; },
    decodeAudioData: vi.fn(async (data: ArrayBuffer) => data),
    addEventListener: vi.fn(),
  };
  vi.stubGlobal("window", { AudioContext: class { constructor() { return context; } } });
  const fetchMock = vi.fn(async (url: string) => ({
    ok: !fail, status: fail ? 404 : 200,
    arrayBuffer: async () => url,
  }));
  vi.stubGlobal("fetch", fetchMock);
  const audio = new GameAudio();
  audio.unlock();
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("shield-acquired.mp3")));
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  return { audio, context, sources, oscillators, gains };
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("approved sound palette", () => {
  it("plays audible, distinct palette variants for alien launch and firewall impact", async () => {
    const { audio, context, sources, gains } = await setup();
    audio.alienFire();
    audio.firewallHit();
    expect(sources[0]!.buffer).toBe("/assets/sfx/player-cannon.mp3");
    expect(sources[0]!.playbackRate.value).toBe(0.72);
    expect(sources[0]!.stop).toHaveBeenCalledWith(0.75);
    expect(sources[1]!.buffer).toBe("/assets/sfx/alien-destruction.mp3");
    expect(sources[1]!.playbackRate.value).toBe(0.88);
    expect(sources[1]!.stop).toHaveBeenCalledWith(1.15);
    expect(gains.some((gain) => gain.gain.value === 0.75)).toBe(true);
    expect(gains.some((gain) => gain.gain.value === 0.8)).toBe(true);
    audio.alienFire();
    audio.firewallHit();
    expect(sources).toHaveLength(2);
    context.currentTime = 1;
    audio.firewallHit(true);
    expect(gains.some((gain) => gain.gain.value === 0.28)).toBe(true);
  });

  it("does not steal player cannon, shield-loss or reactor voices for supporting effects", async () => {
    const { audio, context, sources } = await setup();
    audio.playerFire();
    audio.playerHit();
    audio.alienDestroyed();
    for (let index = 0; index < 6; index++) {
      context.currentTime += 0.1;
      audio.alienFire();
      audio.firewallHit();
    }
    expect(sources[0]!.stop).not.toHaveBeenCalled();
    expect(sources[1]!.stop).not.toHaveBeenCalled();
    expect(sources[2]!.stop).not.toHaveBeenCalled();
  });

  it("silences alien launches and firewall impacts while muted or paused", async () => {
    const { audio, sources } = await setup();
    audio.setMuted(true);
    audio.alienFire(); audio.firewallHit();
    audio.setMuted(false);
    audio.setPaused(true);
    audio.alienFire(); audio.firewallHit();
    expect(sources).toHaveLength(0);
  });

  it("gives the march a stronger body and audible resonance while preserving its four-note cycle", async () => {
    const { audio, context, oscillators, gains } = await setup();
    for (let index = 0; index < 5; index++) {
      audio.marchNote();
      context.currentTime += 0.2;
    }
    expect(oscillators).toHaveLength(10);
    [55, 49, 46.25, 41.2, 55].forEach((frequency, index) => {
      expect(oscillators[index * 2]!.frequency.setValueAtTime).toHaveBeenCalledWith(frequency, index * 0.2);
      expect(oscillators[index * 2 + 1]!.frequency.setValueAtTime).toHaveBeenCalledWith(frequency * 3, index * 0.2);
    });
    expect(gains.some((gain) => gain.gain.exponentialRampToValueAtTime.mock.calls.some(([value]) => value === 0.42))).toBe(true);
    expect(gains.some((gain) => gain.gain.exponentialRampToValueAtTime.mock.calls.some(([value]) => value === 0.16))).toBe(true);
    audio.setMuted(true);
    audio.marchNote();
    audio.setMuted(false);
    audio.setPaused(true);
    audio.marchNote();
    expect(oscillators).toHaveLength(10);
  });

  it("uses the reactor signature for mystery ship destruction", async () => {
    const { audio, sources } = await setup();
    audio.mysteryDestroyed();
    expect(sources).toHaveLength(1);
    expect(sources[0]!.buffer).toBe("/assets/sfx/alien-destruction.mp3");
  });

  it("maps actions to S1-S4 without layering the rejected synthesis", async () => {
    const { audio, sources } = await setup();
    audio.playerFire();
    audio.alienDestroyed(3);
    audio.playerHit();
    audio.extraShield();
    expect(sources.map((source) => source.buffer)).toEqual([
      "/assets/sfx/player-cannon.mp3", "/assets/sfx/alien-destruction.mp3",
      "/assets/sfx/shield-loss.mp3", "/assets/sfx/shield-acquired.mp3",
    ]);
    sources.forEach((source) => {
      expect(source.start).toHaveBeenCalledOnce();
      source.onended?.();
      expect(source.disconnect).toHaveBeenCalledOnce();
    });
  });

  it("gates playback when muted or paused, and groups rapid kills", async () => {
    const { audio, context, sources } = await setup();
    audio.setMuted(true);
    audio.playerFire(); audio.playerHit(); audio.extraShield(); audio.alienDestroyed();
    audio.setMuted(false);
    audio.setPaused(true);
    audio.playerFire(); audio.playerHit(); audio.extraShield(); audio.alienDestroyed();
    expect(sources).toHaveLength(0);
    audio.setPaused(false);
    audio.alienDestroyed(5);
    audio.alienDestroyed(2);
    expect(sources).toHaveLength(1);
    context.currentTime += 0.1;
    audio.alienDestroyed();
    expect(sources).toHaveLength(2);
  });

  it("fades oldest tails to bound repeated cannon and explosion overlap", async () => {
    const { audio, context, sources } = await setup();
    for (let index = 0; index < 12; index++) {
      context.currentTime += 0.1;
      audio.playerFire();
    }
    expect(sources.filter((source) => source.stop.mock.calls.length)).toHaveLength(6);
    for (let index = 0; index < 8; index++) {
      context.currentTime += 0.1;
      audio.alienDestroyed();
    }
    expect(sources.slice(12).filter((source) => source.stop.mock.calls.length)).toHaveLength(4);
  });

  it("reports unavailable clips without reverting to rejected sounds", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { audio, sources } = await setup(true);
    audio.playerFire(); audio.alienDestroyed(); audio.playerHit(); audio.extraShield();
    expect(errors).toHaveBeenCalledTimes(4);
    expect(sources).toHaveLength(0);
  });
});
