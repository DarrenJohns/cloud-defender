import { CanvasTexture, SRGBColorSpace } from "three";

export function createDustTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("A 2D canvas context is required to render hit dust.");
  const gradient = context.createRadialGradient(32, 32, 2, 32, 32, 31);
  gradient.addColorStop(0, "rgba(255, 236, 215, 0.75)");
  gradient.addColorStop(0.35, "rgba(220, 174, 151, 0.42)");
  gradient.addColorStop(1, "rgba(130, 106, 105, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  return new CanvasTexture(canvas);
}

export function createMuzzleFlareTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("A 2D canvas context is required to render the muzzle flare.");
  const glow = context.createRadialGradient(64, 64, 0, 64, 64, 60);
  glow.addColorStop(0, "rgba(255, 255, 255, 1)");
  glow.addColorStop(0.18, "rgba(170, 238, 255, 0.85)");
  glow.addColorStop(0.5, "rgba(40, 170, 255, 0.25)");
  glow.addColorStop(1, "rgba(0, 120, 255, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, 128, 128);
  for (const [width, height] of [
    [128, 5],
    [5, 128],
  ] as const) {
    const streak = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    streak.addColorStop(0, "rgba(230, 250, 255, 0.95)");
    streak.addColorStop(1, "rgba(80, 200, 255, 0)");
    context.fillStyle = streak;
    context.fillRect(64 - width / 2, 64 - height / 2, width, height);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export function createCloudHazeTexture(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("A 2D canvas context is required to render cloud haze.");
  const gradient = context.createRadialGradient(64, 64, 18, 64, 64, 64);
  gradient.addColorStop(0, "rgba(255, 255, 255, 0.52)");
  gradient.addColorStop(0.55, "rgba(255, 255, 255, 0.2)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  return new CanvasTexture(canvas);
}

export function seededRandom(seed: number): () => number {
  let value = seed >>> 0 || 1;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 0x1_0000_0000;
  };
}

export function createScorePopupTexture(text: string): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const context = canvas.getContext("2d")!;
  context.font = "700 58px Consolas, 'Cascadia Mono', monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.shadowColor = "rgba(200, 140, 70, 0.75)";
  context.shadowBlur = 14;
  context.fillStyle = "#e3bc85";
  context.fillText(text, 128, 50);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
