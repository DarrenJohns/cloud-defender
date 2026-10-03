import { AdditiveBlending, Box3, BufferGeometry, CanvasTexture, Color, Float32BufferAttribute, Group, Material, Mesh, MeshBasicMaterial, MeshStandardMaterial, Points, SRGBColorSpace, ShaderMaterial, Sprite, SpriteMaterial, Vector3 } from "three";
import { PLAYER_Y, SHIELD_HEIGHT, SHIELD_Y, WORLD_WIDTH } from "../gameLogic";
import { seededRandom } from "./textures";

export function drawBackground(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  viewHeight: number,
): void {
  const image = context.createImageData(width, height);
  const floorColor = [21, 43, 65];
  const backdropColor = [5, 13, 27];
  const nightSkyColor = [1, 3, 10];
  const floorLevel = PLAYER_Y - 0.45;
  const blendHeight = SHIELD_Y - SHIELD_HEIGHT / 2 - 0.25 - floorLevel;

  for (let row = 0; row < height; row += 1) {
    const worldY = (0.5 - (row + 0.5) / height) * viewHeight;
    const floorPosition = Math.max(0, Math.min(1, (worldY - floorLevel) / blendHeight));
    const floorBlend = floorPosition * floorPosition * (3 - 2 * floorPosition);
    const nightPosition = Math.max(0, Math.min(1, (worldY - viewHeight * 0.2) / (viewHeight * 0.3)));
    const nightBlend = nightPosition * nightPosition * (3 - 2 * nightPosition);
    for (let column = 0; column < width; column += 1) {
      const pixel = (row * width + column) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const lowerGradient =
          floorColor[channel]! +
          (backdropColor[channel]! - floorColor[channel]!) * floorBlend;
        image.data[pixel + channel] = Math.round(
          lowerGradient + (nightSkyColor[channel]! - lowerGradient) * nightBlend,
        );
      }
      image.data[pixel + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
}

export const STAR_COUNT = 720;
// Extra stars that live only in the off-screen margin revealed by mouse parallax.
export const STAR_MARGIN_COUNT = 940;
// Margin stars reach this far above the normal top-of-screen (1 = top edge).
export const STAR_MARGIN_HEIGHT = 1.5;
export const STAR_PLANE_Z = -9.4;
// Stars fill the sky from just below screen centre to the top edge, thinning toward the horizon.
export const STAR_LOWEST_SCREEN_Y = -0.18;

export function makeStarField(): { points: Points; material: ShaderMaterial } {
  const geometry = new BufferGeometry();
  const random = seededRandom(0x51a7);
  const count = STAR_COUNT + STAR_MARGIN_COUNT;
  geometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute(
    "aSize",
    new Float32BufferAttribute(
      Array.from({ length: count }, () => {
        const bright = random() < 0.3;
        return bright ? 0.045 + random() * 0.015 : 0.018 + random() * 0.025;
      }),
      1,
    ),
  );
  geometry.setAttribute(
    "aPhase",
    new Float32BufferAttribute(Array.from({ length: count }, () => random() * Math.PI * 2), 1),
  );
  geometry.setAttribute(
    "aBrightness",
    new Float32BufferAttribute(new Float32Array(count).fill(1), 1),
  );
  const material = new ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPixelScale: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: `
      attribute float aSize;
      attribute float aPhase;
      attribute float aBrightness;
      uniform float uTime;
      uniform float uPixelScale;
      varying float vTwinkle;
      void main() {
        float speed = 0.7 + fract(aPhase * 0.37) * 1.5;
        float pulse = 0.5 + 0.5 * sin(uTime * speed + aPhase);
        float brightStar = smoothstep(0.043, 0.05, aSize);
        float glint = pow(pulse, 5.0);
        vTwinkle = (0.35 + 0.65 * pulse + 0.3 * glint * brightStar) * aBrightness;
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        gl_PointSize = max(1.0, aSize * uPixelScale);
      }
    `,
    fragmentShader: `
      varying float vTwinkle;
      void main() {
        vec2 offset = gl_PointCoord - vec2(0.5);
        float distanceFromCenter = length(offset);
        float core = 1.0 - smoothstep(0.08, 0.32, distanceFromCenter);
        float glow = 1.0 - smoothstep(0.12, 0.5, distanceFromCenter);
        float alpha = (core * 0.85 + glow * 0.15) * vTwinkle;
        gl_FragColor = vec4(vec3(0.67, 0.84, 1.0), alpha);
      }
    `,
  });
  const points = new Points(geometry, material);
  points.position.z = STAR_PLANE_Z;
  // Drawn after the clouds so the clouds' depth hides any star behind them.
  points.renderOrder = 1;
  return { points, material };
}

export function makeGradientMaterial(): { material: MeshBasicMaterial; texture: CanvasTexture } {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("A 2D canvas context is required to render the background.");
  drawBackground(context, canvas.width, canvas.height, WORLD_WIDTH);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return {
    material: new MeshBasicMaterial({ map: texture, depthWrite: false }),
    texture,
  };
}

export function softenCloudMaterial(source: Material): Material {
  const material = source.clone();
  material.transparent = true;
  material.opacity *= 0.5;
  if ("color" in material && material.color instanceof Color) {
    // Blend toward the night-sky navy so clouds recede into the background.
    material.color.lerp(new Color("#10243f"), 0.5);
  }
  if (material instanceof MeshStandardMaterial) {
    material.roughness = 0.9;
    material.metalness = 0;
    material.emissive.set("#2c5c92");
    material.emissiveIntensity = 0.05;
  }
  return material;
}

export function makeCloud(
  source: Group,
  x: number,
  y: number,
  scale: number,
  hazeTexture: CanvasTexture,
): Group {
  const cloud = source.clone(true);
  cloud.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.material = Array.isArray(object.material)
      ? object.material.map(softenCloudMaterial)
      : softenCloudMaterial(object.material);
  });
  const bounds = new Box3().setFromObject(cloud);
  const size = bounds.getSize(new Vector3());
  const center = bounds.getCenter(new Vector3());
  const modelScale = (2.35 * scale) / size.x;
  cloud.scale.setScalar(modelScale);
  cloud.position.set(
    x - center.x * modelScale,
    y - center.y * modelScale,
    -4.4 - center.z * modelScale,
  );
  const haze = new Sprite(new SpriteMaterial({
    map: hazeTexture,
    color: "#6f93bf",
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
  }));
  haze.position.z = -0.08;
  haze.scale.set(3.4 * scale / modelScale, 1.8 * scale / modelScale, 1);
  cloud.add(haze);
  return cloud;
}
