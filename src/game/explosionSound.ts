/** A spacecraft breakup: overlapping internal blasts, hull tearing and a deep rumble. */
export function createExplosionSamples(sampleRate: number): Float32Array {
  const duration = 1.7;
  const samples = new Float32Array(Math.ceil(sampleRate * duration));
  let seed = 0x5a17c9;
  let bass = 0;
  let body = 0;
  let peak = 0;
  let filtered = 0;
  let filteredTwice = 0;
  let hull = 0;
  let debris = 0;
  const bassRate = 1 - Math.exp(-2 * Math.PI * 95 / sampleRate);
  const bodyRate = 1 - Math.exp(-2 * Math.PI * 260 / sampleRate);
  // Filter after saturation too: distortion otherwise reintroduces sharp upper harmonics.
  const outputRate = 1 - Math.exp(-2 * Math.PI * 480 / sampleRate);
  const hullRate = 1 - Math.exp(-2 * Math.PI * 1600 / sampleRate);
  const debrisRate = 1 - Math.exp(-2 * Math.PI * 700 / sampleRate);
  const internalBlasts = [
    { start: 0.055, strength: 1, decay: 11 },
    { start: 0.19, strength: 0.8, decay: 9 },
    { start: 0.37, strength: 0.55, decay: 8 },
    { start: 0.61, strength: 0.3, decay: 7 },
  ];
  const reflectionDelays = [0.043, 0.097, 0.163].map((seconds) => Math.round(seconds * sampleRate));
  for (let index = 0; index < samples.length; index += 1) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const noise = (seed >>> 0) / 0xffffffff * 2 - 1;
    const time = index / sampleRate;
    bass += (noise - bass) * bassRate;
    body += (noise - body) * bodyRate;
    hull += (noise - hull) * hullRate;
    debris += (noise - debris) * debrisRate;
    const rise = Math.min(1, time / 0.04);
    const attack = rise * rise * (3 - 2 * rise);
    const fade = Math.min(1, (duration - time) / 0.2);
    // Aperiodic turbulence supplies the weight without the pitched pulse of a kick drum.
    let ruptures = 0;
    for (const burst of internalBlasts) {
      const age = time - burst.start;
      if (age >= 0) ruptures += burst.strength * Math.min(1, age / 0.012) * Math.exp(-age * burst.decay);
    }
    const blast = body * (3 + ruptures * 5) * Math.exp(-Math.max(0, time - 0.12) * 3)
      + bass * (20 + ruptures * 12) * Math.exp(-Math.max(0, time - 0.22) * 2.8);
    let reflected = 0;
    reflectionDelays.forEach((delay, reflection) => {
      if (index >= delay) reflected += samples[index - delay]! * (0.15 - reflection * 0.03);
    });
    filtered += (Math.tanh((blast + reflected) * 0.65) * attack - filtered) * outputRate;
    filteredTwice += (filtered - filteredTwice) * outputRate;
    const hullTear = (hull - debris) * 0.15 * Math.exp(-time * 9) * attack;
    const fragments = debris * ruptures * 0.45;
    samples[index] = (filteredTwice + hullTear + fragments) * fade;
    peak = Math.max(peak, Math.abs(samples[index]!));
  }
  for (let index = 0; index < samples.length; index += 1) samples[index] = samples[index]! * 0.9 / peak;
  return samples;
}
