import { ALL_VOICE_LINES, AnnouncerQueue, VOICE_MAX_WAIT_SECONDS } from "./announcer";
import type { VoiceLine } from "./announcer";

const PALETTE_FILES = {
  cannon: "player-cannon.mp3",
  destruction: "alien-destruction.mp3",
  shieldLoss: "shield-loss.mp3",
  shieldAward: "shield-acquired.mp3",
} as const;
type PaletteSound = keyof typeof PALETTE_FILES;
type PaletteGroup = PaletteSound | "alienLaunch" | "firewallImpact";
type PalettePlayback = {
  group?: PaletteGroup;
  rate?: number;
  duration?: number;
  lowpass?: number;
};
const PALETTE_LIMITS: Record<PaletteGroup, number> = {
  cannon: 6,
  destruction: 4,
  shieldLoss: 2,
  shieldAward: 1,
  alienLaunch: 3,
  firewallImpact: 3,
};

const MARCH_NOTES = [55, 49, 46.25, 41.2];
const MASTER_VOLUME = 0.32;
// Relative to the master; the announcer sits clearly above the effects.
const VOICE_VOLUME = 1.1;
// Effects dip to this level while a line is spoken so the words stay intelligible.
const VOICE_DUCK_LEVEL = 0.5;

type AudioContextConstructor = typeof AudioContext;

/** Rendered sci-fi palette and supporting synthesis, gated by unlock, mute and pause. */
export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private readonly paletteBuffers = new Map<PaletteSound, AudioBuffer>();
  private readonly paletteLoads = new Map<PaletteSound, Promise<void>>();
  private readonly paletteSources = new Map<PaletteGroup, { source: AudioBufferSourceNode; gain: GainNode }[]>();
  private muted: boolean;
  private paused = false;
  private marchStep = 0;
  private humNodes: { oscillator: OscillatorNode; wobble: OscillatorNode; envelope: GainNode } | null = null;
  private readonly lastPlayed = new Map<string, number>();
  private sfxBus: GainNode | null = null;
  private voiceBus: GainNode | null = null;
  private readonly voiceBuffers = new Map<VoiceLine, AudioBuffer>();
  private readonly announcer = new AnnouncerQueue();
  private voiceSource: AudioBufferSourceNode | null = null;
  private voicesLoading = false;
  private awaitingVoices: { line: VoiceLine; requestedAt: number }[] = [];
  private awaitingUnlock: VoiceLine[] = [];

  constructor(
    muted = false,
    private readonly voiceBaseUrl = `${import.meta.env.BASE_URL}assets/voice/`,
  ) {
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
      this.sfxBus = this.context.createGain();
      this.sfxBus.connect(this.master);
      this.voiceBus = this.createVoiceBus(this.context, this.master);
      this.noiseBuffer = this.createNoiseBuffer(this.context);
      for (const sound of Object.keys(PALETTE_FILES) as PaletteSound[]) {
        this.paletteLoads.set(sound, this.loadPaletteSound(this.context, sound));
      }
      const context = this.context;
      context.addEventListener("statechange", () => {
        if (context.state !== "running" || this.awaitingUnlock.length === 0) return;
        const lines = this.awaitingUnlock;
        this.awaitingUnlock = [];
        for (const line of lines) this.announce(line);
      });
      void this.loadVoices(this.context);
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
    this.tone({ type: "square", from: frequency, to: frequency * 0.97, duration: 0.15, volume: 0.42, lowpass: 650 });
    // Upper resonance keeps the pulse audible without relying on sub-bass playback.
    this.tone({ type: "triangle", from: frequency * 3, to: frequency * 2.91, duration: 0.12, volume: 0.16, lowpass: 900 });
  }

  playerFire(): void {
    if (!this.throttle("fire", 0.05)) return;
    this.playPalette("cannon", 0.8);
  }

  alienFire(): void {
    if (!this.throttle("alienFire", 0.06)) return;
    this.playPalette("cannon", 0.75, { group: "alienLaunch", rate: 0.72, duration: 0.75, lowpass: 2400 });
  }

  alienDestroyed(count = 1): void {
    if (!this.throttle("alienDestroyed", 0.03)) return;
    this.playPalette("destruction", Math.min(1.2, 1 + (count - 1) * 0.06));
  }

  firewallHit(quiet = false): void {
    if (!this.throttle("firewall", 0.04)) return;
    this.playPalette("destruction", quiet ? 0.28 : 0.8, {
      group: "firewallImpact", rate: 0.88, duration: 1.15, lowpass: 3400,
    });
  }

  firewallDestroyed(quiet = false): void {
    if (!this.throttle("firewallDestroyed", 0.12)) return;
    const volume = quiet ? 0.16 : 0.36;
    // A detonation is mostly turbulent noise, not an audible descending musical note.
    this.noise({ duration: 0.12, volume: 0.16 * volume, filter: "lowpass", from: 2800, to: 700, q: 0.5, attack: 0.001, hold: 0.015 });
    this.noise({ duration: 1.6, volume: 0.75 * volume, filter: "lowpass", from: 1800, to: 180, q: 0.7, attack: 0.003, hold: 0.18 });
    this.noise({ duration: 2.6, volume: 1.1 * volume, filter: "lowpass", from: 320, to: 70, q: 1.2, attack: 0.008, hold: 0.35 });
    // Sustained low and mid-bass body remains audible on speakers that cannot reproduce sub-bass.
    this.tone({ type: "sine", from: 68, to: 42, duration: 1.3, volume: 0.65 * volume, lowpass: 160, hold: 0.12 });
    this.tone({ type: "triangle", from: 112, to: 76, duration: 0.95, volume: 0.35 * volume, lowpass: 300, hold: 0.08 });
    this.noise({ duration: 1.2, volume: 0.4 * volume, filter: "bandpass", from: 420, to: 130, q: 0.7, delay: 0.15, hold: 0.12 });
    this.noise({ duration: 0.9, volume: 0.1 * volume, filter: "bandpass", from: 900, to: 350, q: 0.6, delay: 0.32, hold: 0.03 });
  }

  groundHit(quiet = false): void {
    if (!this.throttle("ground", 0.05)) return;
    this.noise({ duration: 0.2, volume: quiet ? 0.1 : 0.17, filter: "lowpass", from: 700, to: 160, q: 0.7 });
    this.tone({ type: "sine", from: 120, to: 50, duration: 0.18, volume: quiet ? 0.08 : 0.14 });
  }

  playerHit(): void {
    this.playPalette("shieldLoss", 0.9);
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
    oscillator.connect(filter).connect(envelope).connect(this.sfxBus!);
    oscillator.start(now);
    wobble.start(now);
    this.humNodes = { oscillator, wobble, envelope };
  }

  extraShield(): void {
    this.playPalette("shieldAward", 0.9);
  }

  mysteryDestroyed(): void {
    this.stopMysteryHum();
    this.playPalette("destruction", 1.15);
  }

  /** Speaks an announcer line, subject to priority, queueing and cooldown rules. */
  announce(line: VoiceLine): void {
    if (this.context?.state === "suspended" && !this.muted && !this.paused) {
      // Waiting for the first user gesture; play in order once the browser allows audio.
      if (!this.awaitingUnlock.includes(line)) this.awaitingUnlock.push(line);
      return;
    }
    const context = this.ready();
    if (!context) return;
    if (!this.voiceBuffers.has(line)) {
      // The very first lines can arrive while clips are still decoding; replay once they're ready.
      if (this.voicesLoading) this.awaitingVoices.push({ line, requestedAt: context.currentTime });
      return;
    }
    const decision = this.announcer.request(line, context.currentTime);
    if (decision === "play" || decision === "interrupt") this.startVoice(context, line);
  }

  /**
   * Speaks a line as soon as the browser allows audio. Outside a user gesture the context starts
   * suspended, so the line waits and plays on the first interaction instead of being lost.
   */
  announceWhenAllowed(line: VoiceLine): void {
    this.unlock();
    this.announce(line);
  }

  /** Silences the announcer and forgets queued lines, e.g. when a new game starts. */
  stopVoice(): void {
    this.announcer.reset();
    this.awaitingVoices = [];
    this.awaitingUnlock = [];
    const source = this.voiceSource;
    this.voiceSource = null;
    if (source) {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    }
    this.restoreDuck();
  }

  private startVoice(context: AudioContext, line: VoiceLine): void {
    const buffer = this.voiceBuffers.get(line);
    if (!buffer || !this.voiceBus) return;
    const previous = this.voiceSource;
    if (previous) {
      previous.onended = null;
      try {
        previous.stop();
      } catch {
        // Already stopped.
      }
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.voiceBus);
    const now = context.currentTime;
    source.start(now);
    this.voiceSource = source;
    this.announcer.started(line, now, buffer.duration);
    this.duck(now, buffer.duration);
    source.onended = () => {
      if (this.voiceSource !== source) return;
      this.voiceSource = null;
      const ready = this.ready();
      const next = ready ? this.announcer.next(ready.currentTime) : null;
      if (ready && next) this.startVoice(ready, next);
    };
  }

  private duck(now: number, duration: number): void {
    const gain = this.sfxBus?.gain;
    if (!gain) return;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(VOICE_DUCK_LEVEL, now + 0.06);
    gain.setValueAtTime(VOICE_DUCK_LEVEL, now + duration);
    gain.linearRampToValueAtTime(1, now + duration + 0.35);
  }

  private restoreDuck(): void {
    if (!this.context || !this.sfxBus) return;
    const gain = this.sfxBus.gain;
    const now = this.context.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(1, now + 0.2);
  }

  /** Light "comms" colouring: trims lows and adds a little presence, without sounding harsh. */
  private createVoiceBus(context: AudioContext, destination: AudioNode): GainNode {
    const input = context.createGain();
    input.gain.value = VOICE_VOLUME;
    const highpass = context.createBiquadFilter();
    highpass.type = "highpass";
    // Gentle band-limit keeps the deep announcer body while staying out of the SFX low end.
    highpass.frequency.value = 75;
    const presence = context.createBiquadFilter();
    presence.type = "peaking";
    presence.frequency.value = 2600;
    presence.Q.value = 0.9;
    presence.gain.value = 2;
    const lowpass = context.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 9000;
    input.connect(highpass).connect(presence).connect(lowpass).connect(destination);
    return input;
  }

  private playPalette(sound: PaletteSound, volume: number, playback: PalettePlayback = {}, waitForLoad = true): void {
    const context = this.ready();
    if (!context || !this.sfxBus) return;
    const buffer = this.paletteBuffers.get(sound);
    if (!buffer) {
      const loading = this.paletteLoads.get(sound);
      const requestedAt = context.currentTime;
      if (loading && waitForLoad) void loading.then(() => {
        if (context.currentTime - requestedAt < 0.25) this.playPalette(sound, volume, playback, false);
      });
      return;
    }
    const source = context.createBufferSource();
    const gain = context.createGain();
    const group = playback.group ?? sound;
    const active = this.paletteSources.get(group) ?? [];
    this.paletteSources.set(group, active);
    if (active.length >= PALETTE_LIMITS[group]) {
      const oldest = active.shift()!;
      oldest.gain.gain.cancelScheduledValues(context.currentTime);
      oldest.gain.gain.setValueAtTime(oldest.gain.gain.value, context.currentTime);
      oldest.gain.gain.linearRampToValueAtTime(0, context.currentTime + 0.06);
      oldest.source.stop(context.currentTime + 0.06);
    }
    const entry = { source, gain };
    active.push(entry);
    source.buffer = buffer;
    source.playbackRate.value = playback.rate ?? 1;
    gain.gain.value = volume;
    let filter: BiquadFilterNode | undefined;
    if (playback.lowpass) {
      filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = playback.lowpass;
      source.connect(filter).connect(gain);
    } else {
      source.connect(gain);
    }
    gain.connect(this.sfxBus);
    source.onended = () => {
      const index = active.indexOf(entry);
      if (index !== -1) active.splice(index, 1);
      source.disconnect();
      filter?.disconnect();
      gain.disconnect();
    };
    source.start();
    if (playback.duration) {
      const end = context.currentTime + playback.duration;
      gain.gain.setValueAtTime(volume, end - 0.08);
      gain.gain.linearRampToValueAtTime(0, end);
      source.stop(end);
    }
  }

  private async loadPaletteSound(context: AudioContext, sound: PaletteSound): Promise<void> {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}assets/sfx/${PALETTE_FILES[sound]}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.paletteBuffers.set(sound, await context.decodeAudioData(await response.arrayBuffer()));
    } catch (error) {
      console.error(`Could not load sound palette clip: ${sound}`, error);
    }
  }

  private async loadVoices(context: AudioContext): Promise<void> {
    this.voicesLoading = true;
    await Promise.all(
      ALL_VOICE_LINES.map(async (line) => {
        try {
          const response = await fetch(`${this.voiceBaseUrl}${line}.mp3`);
          if (!response.ok) return;
          const buffer = await context.decodeAudioData(await response.arrayBuffer());
          this.voiceBuffers.set(line, buffer);
        } catch {
          // A missing or undecodable clip just means that line stays silent.
        }
      }),
    );
    this.voicesLoading = false;
    const waiting = this.awaitingVoices;
    this.awaitingVoices = [];
    // Replayed in order so the announcer queue sequences them (e.g. welcome, then get ready).
    for (const entry of waiting) {
      if (context.currentTime - entry.requestedAt <= VOICE_MAX_WAIT_SECONDS) this.announce(entry.line);
    }
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
    hold?: number;
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
    if (options.hold) envelope.gain.setValueAtTime(options.volume, start + 0.008 + options.hold);
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    let output: AudioNode = oscillator;
    if (options.lowpass) {
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = options.lowpass;
      output = output.connect(filter);
    }
    output.connect(envelope).connect(this.sfxBus!);
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
    hold?: number;
    delay?: number;
  }): void {
    const context = this.ready();
    if (!context || !this.master || !this.noiseBuffer) return;
    const start = context.currentTime + (options.delay ?? 0);
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
    if (options.hold) envelope.gain.setValueAtTime(options.volume, start + attack + options.hold);
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    source.connect(filter).connect(envelope).connect(this.sfxBus!);
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
