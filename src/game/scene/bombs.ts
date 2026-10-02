import { AdditiveBlending, BoxGeometry, CanvasTexture, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, NearestFilter, OctahedronGeometry, PlaneGeometry, SRGBColorSpace, SphereGeometry, TorusGeometry, Vector3 } from "three";
import type { BombKind } from "../gameLogic";
import { seededRandom } from "./textures";

export const BINARY_STREAM_LENGTH = 4;
export const BINARY_GLYPH_HEIGHT = 0.38;
export const BINARY_GLYPH_SPACING = 0.29;
export const BINARY_FLICKER_SECONDS = 0.07;

export function createBinaryGlyphTextures(): [CanvasTexture, CanvasTexture] {
  return ["0", "1"].map((digit) => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 96;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is unavailable.");
    context.font = "bold 72px Consolas, 'Courier New', monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.shadowColor = "#16b9ff";
    context.shadowBlur = 16;
    context.fillStyle = "#70e4ff";
    context.fillText(digit, 32, 50);
    context.shadowBlur = 4;
    context.fillStyle = "#e6fbff";
    context.fillText(digit, 32, 50);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
  }) as [CanvasTexture, CanvasTexture];
}

export function makeBinaryStream(
  glyphGeometry: PlaneGeometry,
  textures: [CanvasTexture, CanvasTexture],
  seed: number,
): Group {
  const stream = new Group();
  const random = seededRandom(seed);
  for (let index = 0; index < BINARY_STREAM_LENGTH; index += 1) {
    const material = new MeshBasicMaterial({
      map: textures[random() < 0.5 ? 0 : 1],
      transparent: true,
      opacity: 1 - index * 0.22,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const glyph = new Mesh(glyphGeometry, material);
    const scale = 1 - index * 0.12;
    glyph.scale.setScalar(scale);
    glyph.position.y = -index * BINARY_GLYPH_SPACING;
    stream.add(glyph);
  }
  return stream;
}

export const MALWARE_CUBE_SIZE = 0.3;
export const HEX_TRAIL_LENGTH = 3;
export const HEX_GLYPH_WIDTH = 0.34;
export const HEX_GLYPH_HEIGHT = 0.24;
export const HEX_GLYPH_SPACING = 0.24;
export const HEX_GLYPHS = ["0x", "F3", "DE", "AD", "!!", "7F", "C0", "FF"] as const;

export interface MalwareFaceTextures {
  map: CanvasTexture;
  emissiveMap: CanvasTexture;
}

// Pixel-art cube face: a voxel-edged red panel with a warning triangle. The emissive map lights only
// the triangle and edge pixels so the faces still pick up scene lighting.
export function createMalwareFaceTextures(): MalwareFaceTextures {
  const size = 16;
  const draw = (emissive: boolean): CanvasTexture => {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is unavailable.");
    context.fillStyle = emissive ? "#000000" : "#4a0c14";
    context.fillRect(0, 0, size, size);
    for (let index = 0; index < size; index += 1) {
      const lit = index % 3 !== 1;
      context.fillStyle = emissive ? (lit ? "#2a0608" : "#000000") : (lit ? "#9a2a34" : "#6e1620");
      for (const [x, y] of [[index, 0], [index, size - 1], [0, index], [size - 1, index]] as const) {
        context.fillRect(x, y, 1, 1);
      }
    }
    // Warning triangle rows (row index, half-width), drawn as chunky pixels.
    context.fillStyle = emissive ? "#6a3410" : "#c98a3e";
    for (let row = 0; row < 10; row += 1) {
      const half = Math.floor(row / 2);
      context.fillRect(8 - half - 1, 3 + row, half * 2 + 2, 1);
    }
    context.fillStyle = emissive ? "#000000" : "#2a0406";
    context.fillRect(7, 6, 2, 4);
    context.fillRect(7, 11, 2, 1);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.generateMipmaps = false;
    return texture;
  };
  return { map: draw(false), emissiveMap: draw(true) };
}

export function createHexGlyphTextures(): CanvasTexture[] {
  return HEX_GLYPHS.map((glyph) => {
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D is unavailable.");
    context.font = "bold 46px Consolas, 'Courier New', monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.shadowColor = "#b8323a";
    context.shadowBlur = 10;
    context.fillStyle = "#c8505a";
    context.fillText(glyph, 48, 34);
    context.shadowBlur = 2;
    context.fillStyle = "#e8a8a8";
    context.fillText(glyph, 48, 34);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
  });
}

export function makeMalwareBomb(
  cubeGeometry: BoxGeometry,
  faceTextures: MalwareFaceTextures,
  glyphGeometry: PlaneGeometry,
  glyphTextures: CanvasTexture[],
  seed: number,
): Group {
  const random = seededRandom(seed);
  const bomb = new Group();
  const cube = new Mesh(
    cubeGeometry,
    new MeshStandardMaterial({
      color: "#ffffff",
      map: faceTextures.map,
      emissive: "#ffffff",
      emissiveMap: faceTextures.emissiveMap,
      emissiveIntensity: 0.8,
      roughness: 0.55,
      metalness: 0.15,
    }),
  );
  cube.userData.spinAxis = new Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize();
  cube.userData.spinSpeed = 3 + random() * 2;
  cube.userData.spinOffset = random() * Math.PI * 2;
  bomb.add(cube);
  for (let index = 0; index < HEX_TRAIL_LENGTH; index += 1) {
    const glyph = new Mesh(
      glyphGeometry,
      new MeshBasicMaterial({
        map: glyphTextures[Math.floor(random() * glyphTextures.length)],
        transparent: true,
        opacity: 0.65 - index * 0.18,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    glyph.scale.setScalar(1 - index * 0.14);
    glyph.position.y = MALWARE_CUBE_SIZE * 0.7 + index * HEX_GLYPH_SPACING;
    bomb.add(glyph);
  }
  return bomb;
}

export const WORM_SEGMENTS = 6;
export const WORM_SEGMENT_SPACING = 0.15;
// Seconds of weave each trailing segment lags behind the one in front.
export const WORM_SEGMENT_LAG = 0.055;

/** A self-replicating worm: a chain of segments that weaves as it falls. */
export function makeWormBomb(segmentGeometry: SphereGeometry): Group {
  const worm = new Group();
  for (let index = 0; index < WORM_SEGMENTS; index += 1) {
    const fade = index / (WORM_SEGMENTS - 1);
    const segment = new Mesh(
      segmentGeometry,
      new MeshStandardMaterial({
        color: index === 0 ? "#8cc7a4" : "#5f9f86",
        emissive: "#2f7a62",
        emissiveIntensity: 0.75 - fade * 0.4,
        roughness: 0.45,
        metalness: 0.2,
        transparent: true,
        opacity: 1 - fade * 0.45,
      }),
    );
    segment.scale.setScalar(0.13 - fade * 0.055);
    if (index === 0) segment.scale.set(0.15, 0.12, 0.15);
    worm.add(segment);
  }
  worm.userData.kind = "worm" satisfies BombKind;
  return worm;
}

/** Ransomware: an armoured, dark crystal locked inside two amber rings. */
export function makeRansomwareBomb(coreGeometry: OctahedronGeometry, ringGeometry: TorusGeometry): Group {
  const bomb = new Group();
  const core = new Mesh(
    coreGeometry,
    new MeshStandardMaterial({
      color: "#3a3f4a",
      emissive: "#5a2a30",
      emissiveIntensity: 0.6,
      roughness: 0.3,
      metalness: 0.7,
    }),
  );
  core.scale.set(0.24, 0.33, 0.24);
  bomb.add(core);
  for (let index = 0; index < 2; index += 1) {
    const ring = new Mesh(
      ringGeometry,
      new MeshStandardMaterial({
        color: "#c9a462",
        emissive: "#8a6a32",
        emissiveIntensity: 0.7,
        roughness: 0.4,
        metalness: 0.6,
      }),
    );
    ring.rotation.y = index * (Math.PI / 2);
    bomb.add(ring);
  }
  bomb.userData.kind = "ransomware" satisfies BombKind;
  return bomb;
}

export const BOMB_CANCEL_COLORS: Record<BombKind, { spark: string[]; light: string }> = {
  malware: { spark: ["#c8505a", "#e8a8a8", "#9c4a5a"], light: "#c46a72" },
  worm: { spark: ["#8cc7a4", "#5f9f86", "#b9d7c8"], light: "#6fb08e" },
  ransomware: { spark: ["#c9a462", "#e3c58e", "#8a6a32"], light: "#d9a35f" },
};
