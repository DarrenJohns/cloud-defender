/** Announcer voice lines; each maps to `assets/voice/<id>.mp3`. */
export type VoiceLine =
  | "splash-screen"
  | "start-game"
  | "firewall-lost"
  | "shield-lost"
  | "last-shield"
  | "extra-shield"
  | "zero-day"
  | "wave-secured"
  | "game-over"
  | "next-wave";

export const ALL_VOICE_LINES: readonly VoiceLine[] = [
  "splash-screen",
  "start-game",
  "firewall-lost",
  "shield-lost",
  "last-shield",
  "extra-shield",
  "zero-day",
  "wave-secured",
  "game-over",
  "next-wave",
];

/** Higher numbers interrupt lower ones; equal priority waits its turn. */
export function voicePriority(line: VoiceLine): number {
  switch (line) {
    case "game-over":
      return 4;
    case "last-shield":
      return 3;
    case "shield-lost":
    case "extra-shield":
    case "firewall-lost":
      return 2;
    default:
      return 1;
  }
}

/** The first formation of a run gets the "get ready" call; later ones the generic warning. */
export function waveLine(level: number): VoiceLine {
  return level <= 1 ? "start-game" : "next-wave";
}

/** The same line will not repeat within this many seconds. */
export const VOICE_COOLDOWN_SECONDS = 2;
/** A queued line older than this is dropped instead of playing late. */
export const VOICE_MAX_WAIT_SECONDS = 2.5;

interface Playing {
  line: VoiceLine;
  priority: number;
  endsAt: number;
}

interface Pending {
  line: VoiceLine;
  priority: number;
  requestedAt: number;
}

export type VoiceDecision = "play" | "interrupt" | "queue" | "drop";

/**
 * Decides when announcer lines play: one at a time, higher priority interrupts, at most one line
 * waits, and stale or repeated lines are dropped. Times are in seconds on any monotonic clock.
 */
export class AnnouncerQueue {
  private playing: Playing | null = null;
  private pending: Pending | null = null;
  private readonly lastStarted = new Map<VoiceLine, number>();

  request(line: VoiceLine, now: number): VoiceDecision {
    const last = this.lastStarted.get(line);
    if (last !== undefined && now - last < VOICE_COOLDOWN_SECONDS) return "drop";
    const priority = voicePriority(line);
    const playing = this.isPlaying(now) ? this.playing : null;
    if (!playing) return "play";
    if (priority > playing.priority) return "interrupt";
    if (playing.line === line) return "drop";
    if (!this.pending || priority >= this.pending.priority) {
      this.pending = { line, priority, requestedAt: now };
      return "queue";
    }
    return "drop";
  }

  /** Records that `line` actually started; call after "play" or "interrupt". */
  started(line: VoiceLine, now: number, duration: number): void {
    this.playing = { line, priority: voicePriority(line), endsAt: now + duration };
    this.lastStarted.set(line, now);
    if (this.pending?.line === line) this.pending = null;
  }

  /** Returns the queued line to start now, if the current one has finished and it isn't stale. */
  next(now: number): VoiceLine | null {
    if (this.isPlaying(now) || !this.pending) return null;
    const pending = this.pending;
    this.pending = null;
    if (now - pending.requestedAt > VOICE_MAX_WAIT_SECONDS) return null;
    return pending.line;
  }

  isPlaying(now: number): boolean {
    return this.playing !== null && now < this.playing.endsAt;
  }

  reset(): void {
    this.playing = null;
    this.pending = null;
    this.lastStarted.clear();
  }
}
