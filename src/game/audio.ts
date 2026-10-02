const MARCH_NOTES = [55, 49, 46.25, 41.2];
const MASTER_VOLUME = 0.32;

type AudioContextConstructor = typeof AudioContext;

/** Synthesised retro sound effects; every method is a silent no-op until audio is unlocked. */
export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted: boolean;
  private paused = false;
  private marchStep = 0;
  private humNodes: { oscillator: OscillatorNode; wobble: OscillatorNode; envelope: GainNode } | null = null;
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
  }

  /** Plays the next note of the four-note invader march; call once per formation step. */
  marchNote(): void {
    const frequency = MARCH_NOTES[this.marchStep % MARCH_NOTES.length]!;
    this.marchStep += 1;
    if (!this.throttle("march", 0.07)) return;
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

  formationFlyIn(): void {
    this.noise({ duration: 1.6, volume: 0.07, filter: "bandpass", from: 300, to: 2200, q: 3, attack: 0.9 });
  }

  /** A shot meeting a bomb: a crisp zap, or a metallic clank when armour only cracks. */
  bombCancelled(destroyed: boolean): void {
    if (!this.throttle("bombCancel", 0.04)) return;
    if (destroyed) {
      this.tone({ type: "square", from: 1500, to: 300, duration: 0.11, volume: 0.07, lowpass: 3600 });
      this.noise({ duration: 0.12, volume: 0.1, filter: "highpass", from: 3000, to: 1200, q: 0.8 });
    } else {
      this.tone({ type: "triangle", from: 1900, to: 1700, duration: 0.16, volume: 0.08 });
      this.tone({ type: "square", from: 240, to: 180, duration: 0.08, volume: 0.06, lowpass: 1200 });
    }
  }

  /** Rising blip each time the hit streak earns a higher multiplier. */
  comboUp(multiplier: number): void {
    const base = 440 * 2 ** ((multiplier - 2) * 4 / 12);
    this.tone({ type: "triangle", from: base, to: base, duration: 0.07, volume: 0.07, lowpass: 3000 });
    this.tone({ type: "triangle", from: base * 1.5, to: base * 1.5, duration: 0.12, volume: 0.07, delay: 0.07, lowpass: 3000 });
  }

  /** A short major fanfare with a held fifth under the "wave secured" banner. */
  waveSecured(): void {
    const notes = [523.3, 659.3, 784, 1046.5];
    notes.forEach((frequency, index) => {
      this.tone({ type: "triangle", from: frequency, to: frequency, duration: 0.16, volume: 0.07, delay: 0.35 + index * 0.1, lowpass: 2800 });
    });
    this.tone({ type: "sine", from: 784, to: 784, duration: 0.7, volume: 0.05, delay: 0.75 });
  }

  /** Keeps the mystery ship's warble running while it is on screen; call every frame. */
  mysteryHum(active: boolean): void {
    if (!active) {
      this.stopMysteryHum();
      return;
    }
    const context = this.context;
    if (this.humNodes || !context || !this.master || context.state !== "running") return;
    const oscillator = context.createOscillator();
    oscillator.type = "triangle";
    oscillator.frequency.value = 520;
    const wobble = context.createOscillator();
    wobble.frequency.value = 7;
    const wobbleDepth = context.createGain();
    wobbleDepth.gain.value = 140;
    wobble.connect(wobbleDepth).connect(oscillator.frequency);
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1500;
    const envelope = context.createGain();
    const now = context.currentTime;
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(0.045, now + 0.4);
    oscillator.connect(filter).connect(envelope).connect(this.master);
    oscillator.start(now);
    wobble.start(now);
    this.humNodes = { oscillator, wobble, envelope };
  }

  extraShield(): void {
    const notes = [392, 523.3, 659.3, 784, 1046.5];
    notes.forEach((frequency, index) => {
      this.tone({ type: "triangle", from: frequency, to: frequency, duration: 0.14, volume: 0.09, delay: index * 0.08, lowpass: 3200 });
    });
    this.tone({ type: "sine", from: 1046.5, to: 1046.5, duration: 0.6, volume: 0.06, delay: 0.4 });
  }

  mysteryDestroyed(): void {
    this.stopMysteryHum();
    const notes = [523.3, 659.3, 784, 1046.5, 784, 1046.5];
    notes.forEach((frequency, index) => {
      this.tone({ type: "square", from: frequency, to: frequency, duration: 0.08, volume: 0.06, delay: 0.05 + index * 0.06, lowpass: 2800 });
    });
    this.noise({ duration: 0.35, volume: 0.22, filter: "bandpass", from: 3000, to: 250, q: 1 });
    this.tone({ type: "sawtooth", from: 900, to: 70, duration: 0.3, volume: 0.1, lowpass: 2000 });
  }

  private stopMysteryHum(): void {
    const nodes = this.humNodes;
    if (!nodes || !this.context) return;
    this.humNodes = null;
    const now = this.context.currentTime;
    nodes.envelope.gain.cancelScheduledValues(now);
    nodes.envelope.gain.setValueAtTime(Math.max(0.0001, nodes.envelope.gain.value), now);
    nodes.envelope.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
    nodes.oscillator.stop(now + 0.2);
    nodes.wobble.stop(now + 0.2);
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
