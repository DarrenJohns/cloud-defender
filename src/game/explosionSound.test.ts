import { expect, it } from "vitest";
import { createExplosionSamples } from "./explosionSound";

it.each([24000, 44100, 48000])("creates a bounded detonation with a decaying tail at %i Hz", (rate) => {
  const samples = createExplosionSamples(rate);
  expect(samples.length).toBe(Math.ceil(rate * 1.7));
  let peak = 0;
  let firstEnergy = 0;
  let lastEnergy = 0;
  samples.forEach((sample, index) => {
    expect(Number.isFinite(sample)).toBe(true);
    peak = Math.max(peak, Math.abs(sample));
    if (index < rate * 0.2) firstEnergy += sample * sample;
    if (index >= samples.length - rate * 0.2) lastEnergy += sample * sample;
  });
  expect(peak).toBeCloseTo(0.9);
  expect(Math.abs(samples[0]!)).toBe(0);
  expect(Math.abs(samples[samples.length - 1]!)).toBeLessThan(0.001);
  expect(firstEnergy).toBeGreaterThan(lastEnergy * 10);
});

it.each([24000, 44100, 48000])("keeps the blast bass-heavy rather than crisp at %i Hz", (rate) => {
  const samples = createExplosionSamples(rate);
  let energy = 0;
  let differenceEnergy = 0;
  for (let index = 1; index < samples.length; index += 1) {
    energy += samples[index]! ** 2;
    differenceEnergy += (samples[index]! - samples[index - 1]!) ** 2;
  }
  const effectiveFrequency = rate / (2 * Math.PI) * Math.sqrt(differenceEnergy / energy);
  // Hull breakup adds midrange detail, but the combined sound must remain low-end dominated.
  expect(effectiveFrequency).toBeLessThan(300);
  const attackPeak = Math.max(...samples.slice(0, Math.ceil(rate * 0.01)).map(Math.abs));
  expect(attackPeak).toBeLessThan(0.15);
});
