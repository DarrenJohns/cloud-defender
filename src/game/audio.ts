const FULL_WAVE_SIZE = 18;
const BASE_ENEMY_SPEED = 1.15;
const MARCH_NOTES = [55, 49, 46.25, 41.2];
const MASTER_VOLUME = 0.32;

/** Seconds between march-bass notes: slower for a full, slow wave, faster as aliens thin out and speed up. */
export function marchInterval(enemyCount: number, enemySpeed: number): number {
  const remaining = Math.max(0, Math.min(1, enemyCount / FULL_WAVE_SIZE));
  const speedFactor = Math.pow(BASE_ENEMY_SPEED / Math.max(0.1, enemySpeed), 0.6);
  const interval = 0.62 * speedFactor * (0.3 + 0.7 * remaining);
  return Math.max(0.11, Math.min(0.75, interval));
}

type AudioContextConstructor = typeof AudioContext;

/** Synthesised retro sound effects; every method is a silent no-op until audio is unlocked. */
export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted: boolean;
  private paused = false;
  private marchStep = 0;
  private marchTimer = 0;
  private readonly lastPlayed = new Map<string, number>();

  constructor(muted = false) {
    this.muted = muted;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Must be called from a user gesture (key press or click) so browsers allow playback. */
  unlock(): void {
    if (!this.context) {
      const Constructor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
      if (!Constructor) return;
      try {
        this.context = new Constructor();
      } catch {
        return;
      }
      this.master = this.context.createGain();
      this.master.gain.value = this.targetVolume();
      const compressor = this.context.createDynamicsCompressor();
      compressor.threshold.value = -14;
      compressor.ratio.value = 4;
      this.master.connect(compressor).connect(this.context.destination);
      this.noiseBuffer = this.createNoiseBuffer(this.context);
    }
    if (this.context.state === "suspended") void this.context.resume().catch(() => undefined);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyVolume();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.applyVolume();
  }

  resetMarch(): void {
    this.marchStep = 0;
    this.marchTimer = 0;
  }

  /** Advances the four-note invader march; call every frame while the wave is advancing. */
  updateMarch(deltaSeconds: number, enemyCount: number, enemySpeed: number): void {
    this.marchTimer -= deltaSeconds;
    if (this.marchTimer > 0) return;
    this.marchTimer = marchInterval(enemyCount, enemySpeed);
    const frequency = MARCH_NOTES[this.marchStep % MARCH_NOTES.length]!;
    this.marchStep += 1;
    this.tone({ type: "square", from: frequency, to: frequency * 0.97, duration: 0.11, volume: 0.22, lowpass: 420 });
  }

  playerFire(): void {
    if (!this.throttle("fire", 0.05)) return;
    this.tone({ type: "square", from: 1250, to: 420, duration: 0.09, volume: 0.07, lowpass: 3200 });
  }

  alienFire(): void {
    if (!this.throttle("alienFire", 0.06)) return;
    this.tone({ type: "triangle", from: 260, to: 120, duration: 0.14, volume: 0.12 });
  }

  alienDestroyed(count = 1): void {
    if (!this.throttle("alienDestroyed", 0.03)) return;
    const volume = Math.min(0.32, 0.2 + (count - 1) * 0.06);
    this.noise({ duration: 0.22, volume, filter: "bandpass", from: 2400, to: 300, q: 1.2 });
    this.tone({ type: "square", from: 680, to: 90, duration: 0.18, volume: volume * 0.45, lowpass: 1800 });
  }

  firewallHit(quiet = false): void {
    if (!this.throttle("firewall", 0.04)) return;
    this.noise({ duration: 0.12, volume: quiet ? 0.08 : 0.14, filter: "bandpass", from: 900, to: 500, q: 2 });
  }

  groundHit(quiet = false): void {
    if (!this.throttle("ground", 0.05)) return;
    this.noise({ duration: 0.2, volume: quiet ? 0.1 : 0.17, filter: "lowpass", from: 700, to: 160, q: 0.7 });
    this.tone({ type: "sine", from: 120, to: 50, duration: 0.18, volume: quiet ? 0.08 : 0.14 });
  }

  playerHit(): void {
    this.tone({ type: "sawtooth", from: 440, to: 55, duration: 0.6, volume: 0.16, lowpass: 1600 });
    this.noise({ duration: 0.5, volume: 0.2, filter: "lowpass", from: 2600, to: 200, q: 0.8 });
  }

  gameOver(): void {
    const notes = [392, 311.1, 261.6, 196];
    notes.forEach((frequency, index) => {
      this.tone({ type: "triangle", from: frequency, to: frequency * 0.985, duration: 0.42, volume: 0.15, delay: 0.35 + index * 0.26, lowpass: 1400 });
    });
    this.tone({ type: "sawtooth", from: 55, to: 41, duration: 2.2, volume: 0.1, delay: 0.3, lowpass: 260 });
  }

  waveCleared(): void {
    const notes = [392, 523.3, 659.3, 784];
    notes.forEach((frequency, index) => {
      this.tone({ type: "square", from: frequency, to: frequency, duration: 0.13, volume: 0.07, delay: index * 0.09, lowpass: 2600 });
    });
  }

  formationFlyIn(): void {
    this.noise({ duration: 1.6, volume: 0.07, filter: "bandpass", from: 300, to: 2200, q: 3, attack: 0.9 });
  }

  private targetVolume(): number {
    return this.muted || this.paused ? 0 : MASTER_VOLUME;
  }

  private applyVolume(): void {
    if (!this.context || !this.master) return;
    const gain = this.master.gain;
    const now = this.context.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(this.targetVolume(), now + 0.18);
  }

  private ready(): AudioContext | null {
    if (!this.context || !this.master || this.context.state !== "running") return null;
    if (this.muted || this.paused) return null;
    return this.context;
  }

  private throttle(key: string, seconds: number): boolean {
    const context = this.ready();
    if (!context) return false;
    const last = this.lastPlayed.get(key) ?? -Infinity;
    if (context.currentTime - last < seconds) return false;
    this.lastPlayed.set(key, context.currentTime);
    return true;
  }

  private tone(options: {
    type: OscillatorType;
    from: number;
    to: number;
    duration: number;
    volume: number;
    delay?: number;
    lowpass?: number;
  }): void {
    const context = this.ready();
    if (!context || !this.master) return;
    const start = context.currentTime + (options.delay ?? 0);
    const end = start + options.duration;
    const oscillator = context.createOscillator();
    oscillator.type = options.type;
    oscillator.frequency.setValueAtTime(options.from, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, options.to), end);
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(options.volume, start + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    let output: AudioNode = oscillator;
    if (options.lowpass) {
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = options.lowpass;
      output = output.connect(filter);
    }
    output.connect(envelope).connect(this.master);
    oscillator.start(start);
    oscillator.stop(end + 0.02);
  }

  private noise(options: {
    duration: number;
    volume: number;
    filter: BiquadFilterType;
    from: number;
    to: number;
    q: number;
    attack?: number;
  }): void {
    const context = this.ready();
    if (!context || !this.master || !this.noiseBuffer) return;
    const start = context.currentTime;
    const end = start + options.duration;
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = options.filter;
    filter.Q.value = options.q;
    filter.frequency.setValueAtTime(options.from, start);
    filter.frequency.exponentialRampToValueAtTime(options.to, end);
    const envelope = context.createGain();
    const attack = options.attack ?? 0.005;
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(options.volume, start + attack);
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    source.connect(filter).connect(envelope).connect(this.master);
    source.start(start, Math.random() * 0.5);
    source.stop(end + 0.02);
  }

  private createNoiseBuffer(context: AudioContext): AudioBuffer {
    const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
    return buffer;
  }
}
