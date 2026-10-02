import {
  AmbientLight,
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Box3,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Material,
  Mesh,
  NearestFilter,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PCFSoftShadowMap,
  PlaneGeometry,
  NormalBlending,
  PointLight,
  Points,
  Scene,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { DamageHole, GameState, GroundImpact, Projectile, ShieldHit } from "./gameLogic";
import { ALIEN_VARIANT_COUNT, FORMATION_INTRO_SECONDS, GROUND_Y, PLAYER_MUZZLE_OFFSET, PLAYER_Y, SHIELD_HEIGHT, SHIELD_WIDTH, SHIELD_Y, WORLD_WIDTH, isShieldDamagedAt } from "./gameLogic";

const HALF_WIDTH = WORLD_WIDTH / 2;
const CAMERA_DISTANCE = 20;
// Smallest world height kept in view so the full play field fits on wide, short screens.
const MIN_VIEW_HEIGHT = 15.6;
const CAMERA_HEIGHT = 2;
// Maximum camera offset (world units) when the mouse is at the window edge.
const PARALLAX_X = 4.5;
const PARALLAX_Y = 2.2;
const PARALLAX_EASE = 5;
// Far layers are oversized so the parallax offset never reveals their edges.
const PARALLAX_OVERSCAN = 1.6;
const BACKGROUND_DISTANCE = 30;
const PLAYER_SHADOW_Y = GROUND_Y;
// Depth plane projectiles travel in; bomb splats land on the floor at this depth, in line with the A.
const BOMB_DEPTH = 0.2;
const PLAYER_GROUND_Y = PLAYER_SHADOW_Y;
const DAMAGE_HOLE_CAPACITY = 64;
// Visible crater radius as a fraction of the logical damage-hole radius.
const HOLE_CUT_FACTOR = 0.74;
const SHIELD_CHUNK_COLORS = ["#e13d48", "#fa606a", "#9e202d"];
const ALIEN_MODEL_PATHS = Array.from(
  { length: ALIEN_VARIANT_COUNT },
  (_, index) => `/assets/alien${index + 1}.glb`,
);

interface CloudMotion {
  x: number;
  y: number;
  z: number;
  scale: number;
  driftSpeed: number;
  halfWidth: number;
  phase: number;
}

interface HitParticle {
  object: Mesh<BufferGeometry, MeshStandardMaterial | MeshBasicMaterial> | Sprite;
  velocity: Vector3;
  angularVelocity: Vector3;
  age: number;
  lifetime: number;
  gravity: number;
  initialScale: number;
  kind: "fragment" | "spark" | "dust" | "splat" | "scorch" | "smoke";
  // Particles with a floor bounce stop at the ground instead of falling through it.
  bounce?: boolean;
}

interface AlienDeathAnimation {
  view: Group;
  age: number;
}

interface PlayerDeathAnimation {
  age: number;
  startX: number;
  startY: number;
  targetY: number;
  dropDuration: number;
  shadowStartX: number;
  shadowTargetX: number;
  shadowStartZ: number;
  shadowTargetZ: number;
  shadowStartScaleX: number;
  shadowStartScaleY: number;
  shadowTargetScaleX: number;
  shadowTargetScaleY: number;
  targetRotationX: number;
  targetRotationY: number;
  targetRotationZ: number;
  dustSpawned: boolean;
  // World bounds of the fallen A, sampled for smoke origins once it lands.
  smokeBounds?: Box3;
  smokeTimer: number;
  smokeSeed: number;
}

function createDustTexture(): CanvasTexture {
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

function createMuzzleFlareTexture(): CanvasTexture {
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

function createCloudHazeTexture(): CanvasTexture {
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

function seededRandom(seed: number): () => number {
  let value = seed >>> 0 || 1;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 0x1_0000_0000;
  };
}

function drawBackground(
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

const STAR_COUNT = 220;
// Extra stars that live only in the off-screen margin revealed by mouse parallax.
const STAR_MARGIN_COUNT = 340;
// Margin stars reach this far above the normal top-of-screen (1 = top edge).
const STAR_MARGIN_HEIGHT = 1.5;
const STAR_PLANE_Z = -9.4;
// Stars fill the sky from just below screen centre to the top edge, thinning toward the horizon.
const STAR_LOWEST_SCREEN_Y = -0.18;

function makeStarField(): { points: Points; material: ShaderMaterial } {
  const geometry = new BufferGeometry();
  const random = seededRandom(0x51a7);
  const count = STAR_COUNT + STAR_MARGIN_COUNT;
  geometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute(
    "aSize",
    new Float32BufferAttribute(
      Array.from({ length: count }, () => {
        const sparkle = random() < 0.12;
        return sparkle ? 0.07 + random() * 0.04 : 0.022 + random() * 0.035;
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
      varying float vSparkle;
      void main() {
        float speed = 0.7 + fract(aPhase * 0.37) * 1.5;
        vTwinkle = (0.25 + 0.75 * (0.5 + 0.5 * sin(uTime * speed + aPhase))) * aBrightness;
        vSparkle = smoothstep(0.06, 0.08, aSize);
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        gl_PointSize = aSize * uPixelScale * (0.75 + vTwinkle * 0.5);
      }
    `,
    fragmentShader: `
      varying float vTwinkle;
      varying float vSparkle;
      void main() {
        vec2 offset = gl_PointCoord - vec2(0.5);
        float distanceFromCenter = length(offset);
        float core = 1.0 - smoothstep(0.08, 0.32, distanceFromCenter);
        float glow = 1.0 - smoothstep(0.12, 0.5, distanceFromCenter);
        float rays = max(
          1.0 - smoothstep(0.0, 0.035, abs(offset.x)),
          1.0 - smoothstep(0.0, 0.035, abs(offset.y))
        ) * (1.0 - smoothstep(0.1, 0.5, distanceFromCenter));
        float sparkleCore = 1.0 - smoothstep(0.02, 0.12, distanceFromCenter);
        float plain = core * 0.75 + glow * 0.25;
        float sparkle = sparkleCore + rays * 0.9 + glow * 0.12;
        float alpha = mix(plain, sparkle, vSparkle) * vTwinkle;
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

function makeGradientMaterial(): { material: MeshBasicMaterial; texture: CanvasTexture } {
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

function softenCloudMaterial(source: Material): Material {
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

function makeCloud(
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

function makeErodibleMaterial(
  source: MeshStandardMaterial,
  holes: Vector4[],
): MeshStandardMaterial {
  const material = source.clone();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.damageHoles = { value: holes };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vShieldPosition;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvShieldPosition = position;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform vec4 damageHoles[${DAMAGE_HOLE_CAPACITY}];
        varying vec3 vShieldPosition;
        ${HOLE_EDGE_FUNCTION}
        `,
      )
      .replace(
        "#include <color_fragment>",
        `for (int i = 0; i < ${DAMAGE_HOLE_CAPACITY}; i++) {
          vec4 hole = damageHoles[i];
          if (hole.z > 0.0) {
            vec2 offset = vShieldPosition.xy - hole.xy;
            float edge = ${HOLE_EDGE_GLSL}(offset, hole);
            float distanceToCenter = length(offset);
            if (distanceToCenter < edge) discard;
            // Subtle ambient occlusion on the chipped lip around each crater.
            float lip = smoothstep(edge, edge * 1.12, distanceToCenter);
            diffuseColor.rgb *= mix(0.55, 1.0, lip);
          }
        }
        #include <color_fragment>
        `,
      );
  };
  material.customProgramCacheKey = () => "firewall-mode-a-erosion-v2";
  material.needsUpdate = true;
  return material;
}

// Same jagged outline as gameLogic.isShieldDamagedAt, scaled to the visible cut radius.
const HOLE_EDGE_GLSL = "holeEdge";
const HOLE_EDGE_FUNCTION = `
float holeEdge(vec2 offset, vec4 hole) {
  float angle = atan(offset.y, offset.x);
  return hole.z * ${HOLE_CUT_FACTOR.toFixed(3)} * (
    0.8 +
    0.14 * sin(angle * 2.0 + hole.w) +
    0.08 * sin(angle * 4.0 - hole.w * 1.31) +
    0.025 * sin(angle * 7.0 + hole.w * 2.1)
  );
}
`;

/**
 * Real 3D inner walls for firewall craters: one open tube per damage hole, following the
 * hole's jagged outline and spanning the firewall's depth. Tube faces that fall inside a
 * neighbouring hole or outside the firewall are discarded so overlapping holes form one cavity.
 */
function makeHoleWalls(
  holes: Vector4[],
  halfWidth: number,
  halfHeight: number,
  depth: number,
): InstancedMesh {
  const geometry = new CylinderGeometry(1, 1, 1, 56, 1, true);
  geometry.rotateX(Math.PI / 2);
  const holeIndices = new Float32Array(DAMAGE_HOLE_CAPACITY);
  for (let index = 0; index < DAMAGE_HOLE_CAPACITY; index += 1) holeIndices[index] = index;
  geometry.setAttribute("holeIndex", new InstancedBufferAttribute(holeIndices, 1));

  const material = new MeshStandardMaterial({
    color: "#cf4651",
    roughness: 0.92,
    metalness: 0,
    side: DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.damageHoles = { value: holes };
    shader.uniforms.wallDepth = { value: depth };
    shader.uniforms.wallHalfSize = { value: new Vector2(halfWidth, halfHeight) };
    const declarations = `
      uniform vec4 damageHoles[${DAMAGE_HOLE_CAPACITY}];
      uniform float wallDepth;
      uniform vec2 wallHalfSize;
      varying vec3 vWallPosition;
      varying float vHoleIndex;
      ${HOLE_EDGE_FUNCTION}
    `;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nattribute float holeIndex;\n${declarations}`)
      .replace(
        "#include <beginnormal_vertex>",
        "vec3 objectNormal = vec3(-normalize(position.xy), 0.0);",
      )
      .replace(
        "#include <begin_vertex>",
        `vec4 wallHole = damageHoles[int(holeIndex + 0.5)];
        vec2 wallDirection = normalize(position.xy);
        float wallEdge = holeEdge(wallDirection, wallHole);
        vec3 transformed = vec3(wallHole.xy + wallDirection * wallEdge, position.z * wallDepth);
        vWallPosition = transformed;
        vHoleIndex = holeIndex;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${declarations}`)
      .replace(
        "#include <color_fragment>",
        `if (any(greaterThan(abs(vWallPosition.xy), wallHalfSize))) discard;
        int ownHole = int(vHoleIndex + 0.5);
        for (int i = 0; i < ${DAMAGE_HOLE_CAPACITY}; i++) {
          vec4 hole = damageHoles[i];
          if (i == ownHole || hole.z <= 0.0) continue;
          vec2 offset = vWallPosition.xy - hole.xy;
          if (length(offset) < holeEdge(offset, hole)) discard;
        }
        #include <color_fragment>
        float depthFromFace = 1.0 - abs(vWallPosition.z) / (wallDepth * 0.5);
        diffuseColor.rgb *= mix(1.0, 0.55, smoothstep(0.0, 1.0, depthFromFace));
        `,
      );
  };
  material.customProgramCacheKey = () => "firewall-hole-walls-v1";

  const walls = new InstancedMesh(geometry, material, DAMAGE_HOLE_CAPACITY);
  const identity = new Matrix4();
  for (let index = 0; index < DAMAGE_HOLE_CAPACITY; index += 1) walls.setMatrixAt(index, identity);
  walls.count = 0;
  walls.frustumCulled = false;
  walls.receiveShadow = true;
  return walls;
}

function setDamageUniforms(
  uniforms: Vector4[],
  damageHoles: DamageHole[],
  destroyed: boolean,
): void {
  for (const uniform of uniforms) uniform.set(0, 0, 0, 0);
  if (destroyed) {
    uniforms[0]!.set(0, 0, 100, 0);
    return;
  }
  for (const [index, hole] of damageHoles.slice(0, uniforms.length).entries()) {
    uniforms[index]!.set(hole.x, hole.y, hole.radius, hole.seed);
  }
}

const SHIP_SHADOW_WIDTH = 2.6;
const SHIP_SHADOW_DEPTH = 0.38;
const ALIEN_SHADOW_WIDTH = 1.3;
// Extrudes the alien GLBs along Z at load time so they read as chunkier 3D objects.
const ALIEN_DEPTH_MULTIPLIER = 2;
const ALIEN_SHADOW_DEPTH = 0.34;
// Alien shadows start appearing once an alien is this far above the floor.
const ALIEN_SHADOW_FADE_HEIGHT = 8;
const ALIEN_SHADOW_MAX_OPACITY = 0.85;
const SHIELD_SHADOW_MAX_OPACITY = 0.15;
// Raised slightly above the A's shadow line so the firewalls read as standing just behind the A.
// Aliens and firewalls share a depth row behind the A, so their shadows share one line.
const ROW_SHADOW_LIFT = 0.28;
const SHIELD_SHADOW_COLUMNS = 40;
const SHIELD_SHADOW_ROWS = 10;
const SHIELD_SHADOW_PADDING = 0.3;
const SHIELD_SHADOW_DEPTH = 0.5;

type ShieldShadow = { mesh: Mesh; canvas: HTMLCanvasElement; texture: CanvasTexture; holeCount: number; destroyed: boolean };

function makeShieldShadow(): ShieldShadow {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const texture = new CanvasTexture(canvas);
  const mesh = new Mesh(
    new PlaneGeometry(SHIELD_WIDTH + SHIELD_SHADOW_PADDING * 2, SHIELD_SHADOW_DEPTH),
    new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  mesh.renderOrder = -1;
  return { mesh, canvas, texture, holeCount: -1, destroyed: false };
}

// Draws the shadow as the firewall's silhouette seen from above: each column darkens by how much
// of the wall above it is still intact, so blasted-out sections leave matching gaps on the floor.
function drawShieldShadow(shadow: ShieldShadow, shield: GameState["shields"][number]): void {
  const context = shadow.canvas.getContext("2d");
  if (!context) throw new Error("A 2D canvas context is required to render the firewall shadow.");
  const { width, height } = shadow.canvas;
  context.clearRect(0, 0, width, height);
  if (shield.destroyed) {
    shadow.texture.needsUpdate = true;
    return;
  }
  const padding = (SHIELD_SHADOW_PADDING / (SHIELD_WIDTH + SHIELD_SHADOW_PADDING * 2)) * width;
  const columnWidth = (width - padding * 2) / SHIELD_SHADOW_COLUMNS;
  const mask = document.createElement("canvas");
  mask.width = width;
  mask.height = height;
  const maskContext = mask.getContext("2d");
  if (!maskContext) throw new Error("A 2D canvas context is required to render the firewall shadow.");
  for (let column = 0; column < SHIELD_SHADOW_COLUMNS; column += 1) {
    const x = shield.x - shield.width / 2 + ((column + 0.5) / SHIELD_SHADOW_COLUMNS) * shield.width;
    let intact = 0;
    for (let row = 0; row < SHIELD_SHADOW_ROWS; row += 1) {
      const y = shield.y - shield.height / 2 + ((row + 0.5) / SHIELD_SHADOW_ROWS) * shield.height;
      if (!isShieldDamagedAt(shield, x, y)) intact += 1;
    }
    // Taper the ends so the intact wall casts a soft ellipse like the A's shadow.
    const along = (column + 0.5) / SHIELD_SHADOW_COLUMNS;
    const taper = Math.sqrt(Math.max(0, 1 - Math.pow(2 * along - 1, 2)));
    const alpha = (intact / SHIELD_SHADOW_ROWS) * (0.35 + 0.65 * taper) * SHIELD_SHADOW_MAX_OPACITY;
    if (alpha <= 0) continue;
    const gradient = maskContext.createLinearGradient(0, height * 0.18, 0, height * 0.82);
    gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
    gradient.addColorStop(0.5, `rgba(0, 0, 0, ${alpha.toFixed(3)})`);
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    maskContext.fillStyle = gradient;
    maskContext.fillRect(Math.floor(padding + column * columnWidth), height * 0.18, Math.ceil(columnWidth) + 1, height * 0.64);
  }
  // One blur over the whole silhouette avoids striping between columns.
  context.filter = "blur(7px)";
  context.drawImage(mask, 0, 0);
  context.filter = "none";
  shadow.texture.needsUpdate = true;
}

function makeShipShadow(): Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("A 2D canvas context is required to render the ship shadow.");
  const gradient = context.createRadialGradient(128, 64, 3, 128, 64, 64);
  gradient.addColorStop(0, "rgba(0, 0, 0, 0.56)");
  gradient.addColorStop(0.55, "rgba(0, 0, 0, 0.25)");
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const shadow = new Mesh(
    new PlaneGeometry(SHIP_SHADOW_WIDTH, SHIP_SHADOW_DEPTH),
    new MeshBasicMaterial({
      map: new CanvasTexture(canvas),
      transparent: true,
      depthWrite: false,
    }),
  );
  shadow.position.set(0, PLAYER_SHADOW_Y, -0.15);
  return shadow;
}

function makeAlienShadow(texture: CanvasTexture): Mesh {
  const shadow = new Mesh(
    new PlaneGeometry(ALIEN_SHADOW_WIDTH, ALIEN_SHADOW_DEPTH),
    new MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      opacity: 0,
    }),
  );
  shadow.renderOrder = -1;
  return shadow;
}

function updateAlienShadow(shadow: Mesh, x: number, alienY: number): void {
  const height = Math.max(0, alienY - PLAYER_GROUND_Y);
  const closeness = Math.max(0, Math.min(1, 1 - height / ALIEN_SHADOW_FADE_HEIGHT));
  const eased = closeness * closeness;
  (shadow.material as MeshBasicMaterial).opacity = eased * ALIEN_SHADOW_MAX_OPACITY;
  const scale = 0.7 + closeness * 0.45;
  shadow.scale.set(scale, scale, 1);
  shadow.position.set(x, PLAYER_SHADOW_Y + ROW_SHADOW_LIFT, -0.25);
  shadow.visible = closeness > 0;
}

interface FlightPose {
  x: number;
  y: number;
  z: number;
  bank: number;
  pitch: number;
  yaw: number;
}

// Each alien swoops in from off-screen (top, left or right) along a curved,
// depth-varying path, staggered so the formation assembles organically.
function formationFlightPose(id: number, targetX: number, targetY: number, progress: number): FlightPose {
  const random = seededRandom(id * 7919 + 104729);
  const side = Math.floor(random() * 3);
  let startX: number;
  let startY: number;
  if (side === 0) {
    startX = (random() - 0.5) * 22;
    startY = 10 + random() * 3;
  } else {
    const direction = side === 1 ? -1 : 1;
    startX = direction * (14 + random() * 4);
    startY = 1 + random() * 8;
  }
  const startZ = 2 + random() * 4;
  const controlX = (startX + targetX) / 2 + (random() - 0.5) * 9;
  const controlY = Math.max(startY, targetY) + 0.5 + random() * 3.5;
  const controlZ = startZ * 0.5 + (random() - 0.3) * 3;
  const delay = random() * 0.42;
  const local = Math.max(0, Math.min(1, (progress - delay) / (0.97 - delay)));
  const t = 1 - (1 - local) ** 3;
  const u = 1 - t;
  const bezier = (a: number, b: number, c: number) => u * u * a + 2 * u * t * b + t * t * c;
  const tangentX = 2 * u * (controlX - startX) + 2 * t * (targetX - controlX);
  const tangentY = 2 * u * (controlY - startY) + 2 * t * (targetY - controlY);
  const settle = u * u;
  return {
    x: bezier(startX, controlX, targetX),
    y: bezier(startY, controlY, targetY),
    z: bezier(startZ, controlZ, 0),
    bank: Math.max(-0.9, Math.min(0.9, -tangentX * 0.05)) * settle,
    pitch: Math.max(-0.6, Math.min(0.6, tangentY * 0.04)) * settle,
    yaw: Math.max(-0.7, Math.min(0.7, tangentX * 0.04)) * settle,
  };
}

function makeEnemy(model: Group): Group {
  const enemy = new Group();
  const alien = model.clone(true);
  alien.traverse((object) => {
    if (object instanceof Mesh) object.castShadow = true;
  });
  enemy.add(alien);
  return enemy;
}

const BINARY_STREAM_LENGTH = 4;
const BINARY_GLYPH_HEIGHT = 0.38;
const BINARY_GLYPH_SPACING = 0.29;
const BINARY_FLICKER_SECONDS = 0.07;
const MUZZLE_FLASH_SECONDS = 0.18;
const MUZZLE_LIGHT_INTENSITY = 18;
const SMOKE_COLORS = ["#77808a", "#8a939c", "#9fa7ae", "#646d77"] as const;
// Gentle breeze so the smoke column leans slightly as it rises.
const SMOKE_DRIFT_X = 0.12;
// Fixed-size pool: lights stay in the scene so flashes never trigger shader recompiles.
const IMPACT_LIGHT_COUNT = 3;
const ALIEN_HIT_LIGHT_INTENSITY = 7;
const ALIEN_BURST_LIGHT_INTENSITY = 11;

interface ImpactLight {
  light: PointLight;
  age: number;
  duration: number;
  peak: number;
}

function createBinaryGlyphTextures(): [CanvasTexture, CanvasTexture] {
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

function makeBinaryStream(
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

const MALWARE_CUBE_SIZE = 0.3;
const HEX_TRAIL_LENGTH = 3;
const HEX_GLYPH_WIDTH = 0.34;
const HEX_GLYPH_HEIGHT = 0.24;
const HEX_GLYPH_SPACING = 0.24;
const HEX_GLYPHS = ["0x", "F3", "DE", "AD", "!!", "7F", "C0", "FF"] as const;

interface MalwareFaceTextures {
  map: CanvasTexture;
  emissiveMap: CanvasTexture;
}

// Pixel-art cube face: a voxel-edged red panel with a warning triangle. The emissive map lights only
// the triangle and edge pixels so the faces still pick up scene lighting.
function createMalwareFaceTextures(): MalwareFaceTextures {
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

function createHexGlyphTextures(): CanvasTexture[] {
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

function makeMalwareBomb(
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

export class GameScene {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(45, 1, 0.1, 120);
  private readonly background: Mesh;
  private readonly backgroundTexture: CanvasTexture;
  private readonly stars: Points;
  private readonly starMaterial: ShaderMaterial;
  private readonly clouds: Group[] = [];
  private readonly cloudMotion: CloudMotion[] = [];
  private readonly cloudHazeTexture: CanvasTexture;
  private readonly alienModels: Group[] = [];
  private readonly accentLight = new PointLight("#54bfff", 12, 18, 2);
  private readonly shadow: Mesh;
  private readonly shadowTexture: CanvasTexture;
  private readonly playerRoot = new Group();
  private readonly shieldViews = new Map<number, Group>();
  private readonly shieldShadows = new Map<number, ShieldShadow>();
  private readonly shieldDamageUniforms = new Map<number, Vector4[]>();
  private readonly shieldHoleWalls = new Map<number, InstancedMesh>();
  private readonly shieldHitShake = new Map<number, number>();
  private readonly previousShieldHoleCounts = new Map<number, number>();
  private readonly enemyViews = new Map<number, Group>();
  private readonly enemyShadows = new Map<number, Mesh>();
  private readonly alienDeaths: AlienDeathAnimation[] = [];
  private playerDeath: PlayerDeathAnimation | undefined;
  private playerDeathComplete = false;
  private nextPlayerDeathFallsToward = false;
  private readonly playerShotViews = new Map<number, Group>();
  private readonly binaryGlyphTextures = createBinaryGlyphTextures();
  private readonly binaryGlyphGeometry = new PlaneGeometry(
    (BINARY_GLYPH_HEIGHT * 2) / 3,
    BINARY_GLYPH_HEIGHT,
  );
  private readonly enemyShotViews = new Map<number, Group>();
  private readonly malwareCubeGeometry = new BoxGeometry(MALWARE_CUBE_SIZE, MALWARE_CUBE_SIZE, MALWARE_CUBE_SIZE);
  private readonly malwareFaceTextures = createMalwareFaceTextures();
  private readonly hexGlyphGeometry = new PlaneGeometry(HEX_GLYPH_WIDTH, HEX_GLYPH_HEIGHT);
  private readonly hexGlyphTextures = createHexGlyphTextures();
  private readonly hitParticles: HitParticle[] = [];
  private readonly fragmentGeometry = new IcosahedronGeometry(1, 0);
  private readonly floorDecalGeometry = new PlaneGeometry(1, 1);
  private readonly dustTexture: CanvasTexture;
  private readonly loader = new GLTFLoader();
  private shipLoaded = false;
  private previousShipX = 0;
  private previousLives = 3;
  private hitVibration = 0;
  private previousPlayerFireCooldown = 0;
  private recoil = 0;
  private muzzleFlash = 0;
  private readonly muzzleFlareTexture = createMuzzleFlareTexture();
  private readonly muzzleFlare = new Sprite(
    new SpriteMaterial({
      map: this.muzzleFlareTexture,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    }),
  );
  private readonly muzzleLight = new PointLight("#7fdcff", 0, 3.2, 2);
  private readonly parallaxTarget = new Vector2();
  private readonly parallaxCurrent = new Vector2();
  private readonly backgroundDirection = new Vector3();
  private lastParallaxTime = performance.now();
  private readonly impactLights: ImpactLight[] = Array.from(
    { length: IMPACT_LIGHT_COUNT },
    () => ({ light: new PointLight("#7fdcff", 0, 4, 2), age: 1, duration: 1, peak: 0 }),
  );

  constructor(container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.outputColorSpace = "srgb";
    this.dustTexture = createDustTexture();
    this.cloudHazeTexture = createCloudHazeTexture();
    container.append(this.renderer.domElement);
    this.camera.position.set(0, CAMERA_HEIGHT, CAMERA_DISTANCE);
    this.camera.lookAt(0, 0, 0);

    const backgroundGradient = makeGradientMaterial();
    this.backgroundTexture = backgroundGradient.texture;
    this.background = new Mesh(new PlaneGeometry(1, 1), backgroundGradient.material);
    this.background.position.z = -10;
    const starField = makeStarField();
    this.stars = starField.points;
    this.starMaterial = starField.material;
    this.scene.add(this.background, this.stars);
    this.scene.add(new AmbientLight("#bedaff", 1.15));

    const keyLight = new DirectionalLight("#ffffff", 2.2);
    keyLight.position.set(-4, 7, 8);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.left = -9;
    keyLight.shadow.camera.right = 9;
    keyLight.shadow.camera.top = 9;
    keyLight.shadow.camera.bottom = -9;
    this.scene.add(keyLight);
    this.accentLight.position.set(-7, 1, 6);
    this.scene.add(this.accentLight);
    this.muzzleFlare.visible = false;
    this.muzzleFlare.renderOrder = 3;
    this.scene.add(this.muzzleFlare, this.muzzleLight);
    for (const impact of this.impactLights) this.scene.add(impact.light);

    this.shadow = makeShipShadow();
    this.shadowTexture = (this.shadow.material as MeshBasicMaterial).map as CanvasTexture;
    this.scene.add(this.shadow, this.playerRoot);
    this.resize();
    window.addEventListener("resize", this.resize);
    window.addEventListener("pointerdown", this.handlePointerDown);
    window.addEventListener("pointerup", this.handlePointerUp);
    window.addEventListener("pointercancel", this.handlePointerUp);
    window.addEventListener("pointermove", this.handlePointerMove);
    document.documentElement.addEventListener("mouseleave", this.resetParallaxTarget);
    window.addEventListener("blur", this.resetParallaxTarget);
  }

  loadShip(onReady: () => void, onError: (message: string) => void): void {
    this.loader.load(
      "/assets/azure.glb",
      (gltf) => {
        const model = gltf.scene;
        const bounds = new Box3().setFromObject(model);
        const size = bounds.getSize(new Vector3());
        const largestDimension = Math.max(size.x, size.y, size.z);
        if (largestDimension <= 0) {
          onError("The model at public/assets/azure.glb has no visible geometry.");
          return;
        }

        const modelScale = 1.25 / largestDimension;
        model.scale.set(modelScale, modelScale, modelScale * 2);
        const center = bounds.getCenter(new Vector3()).multiply(model.scale);
        model.position.set(-center.x, -center.y, -center.z);
        model.traverse((object: Object3D) => {
          if (object instanceof Mesh) {
            object.castShadow = true;
            object.receiveShadow = true;
          }
        });
        this.playerRoot.add(model);
        this.playerRoot.position.set(0, PLAYER_Y, 0);
        this.shipLoaded = true;
        onReady();
      },
      undefined,
      () => onError("Could not load public/assets/azure.glb. Add the Azure ship model and reload."),
    );
  }

  loadAliens(onReady: () => void, onError: (message: string) => void): void {
    Promise.all(
      ALIEN_MODEL_PATHS.map(async (path) => {
        let model: Group;
        try {
          model = (await this.loader.loadAsync(path)).scene;
        } catch {
          throw new Error(`Could not load public${path}.`);
        }

        model.updateMatrixWorld(true);
        const bounds = new Box3().setFromObject(model);
        const size = bounds.getSize(new Vector3());
        if (size.x <= 0 || size.y <= 0) {
          throw new Error(`The model at public${path} has invalid dimensions.`);
        }

        const center = bounds.getCenter(new Vector3());
        const scale = 0.92 / Math.max(size.x, size.y);
        const depthScale = scale * ALIEN_DEPTH_MULTIPLIER;
        const normalized = new Group();
        normalized.add(model);
        normalized.scale.set(scale, scale, depthScale);
        normalized.position.set(-center.x * scale, -center.y * scale, -center.z * depthScale);
        return normalized;
      }),
    )
      .then((models) => {
        this.alienModels.push(...models);
        onReady();
      })
      .catch((error: unknown) => {
        onError(error instanceof Error ? error.message : "Could not load the alien models.");
      });
  }

  loadShields(onReady: () => void, onError: (message: string) => void): void {
    this.loader.load(
      "/assets/firewall.glb",
      (gltf) => {
        const source = gltf.scene;
        source.updateMatrixWorld(true);
        const bounds = new Box3().setFromObject(source);
        const size = bounds.getSize(new Vector3());
        if (size.x <= 0 || size.y <= 0 || size.z <= 0) {
          onError("The model at public/assets/firewall.glb has invalid dimensions.");
          return;
        }

        const center = bounds.getCenter(new Vector3());
        const scaleX = SHIELD_WIDTH / size.x;
        const scaleY = SHIELD_HEIGHT / size.y;
        const scaleZ = scaleX;
        const normalization = new Matrix4().makeScale(scaleX, scaleY, scaleZ);
        normalization.setPosition(
          -center.x * scaleX,
          -center.y * scaleY,
          -center.z * scaleZ,
        );
        const meshes: { object: Mesh; material: MeshStandardMaterial }[] = [];
        let hasUnsupportedMaterial = false;
        source.traverse((object) => {
          if (!(object instanceof Mesh)) return;
          if (!(object.material instanceof MeshStandardMaterial)) {
            hasUnsupportedMaterial = true;
            return;
          }
          meshes.push({ object, material: object.material });
        });
        if (meshes.length === 0) {
          onError("The model at public/assets/firewall.glb contains no meshes.");
          return;
        }
        if (hasUnsupportedMaterial) {
          onError("The firewall GLB must use a standard PBR material.");
          return;
        }

        for (let id = 0; id < 4; id += 1) {
          const group = new Group();
          group.position.set(-5.7 + id * 3.8, SHIELD_Y, 0);
          this.scene.add(group);
          this.shieldViews.set(id, group);
          this.shieldHitShake.set(id, 0);
          this.previousShieldHoleCounts.set(id, 0);

          const uniforms = Array.from(
            { length: DAMAGE_HOLE_CAPACITY },
            () => new Vector4(),
          );
          this.shieldDamageUniforms.set(id, uniforms);
          const materials = new Map<MeshStandardMaterial, MeshStandardMaterial>();

          for (const { object, material: sourceMaterial } of meshes) {
            let material = materials.get(sourceMaterial);
            if (!material) {
              material = makeErodibleMaterial(sourceMaterial, uniforms);
              materials.set(sourceMaterial, material);
            }

            const geometry = object.geometry.clone();
            const objectTransform = normalization.clone().multiply(object.matrixWorld);
            geometry.applyMatrix4(objectTransform);
            geometry.computeBoundingSphere();
            const piece = new Mesh(geometry, material);
            piece.castShadow = true;
            piece.receiveShadow = true;
            group.add(piece);
          }

          const walls = makeHoleWalls(
            uniforms,
            SHIELD_WIDTH / 2,
            SHIELD_HEIGHT / 2,
            size.z * scaleZ * 0.98,
          );
          group.add(walls);
          this.shieldHoleWalls.set(id, walls);
        }
        onReady();
      },
      undefined,
      () => onError("Could not load public/assets/firewall.glb."),
    );
  }

  loadClouds(onReady: () => void, onError: (message: string) => void): void {
    this.loader.load(
      "/assets/cloud.glb",
      (gltf) => {
        const source = gltf.scene;
        source.updateMatrixWorld(true);
        const bounds = new Box3().setFromObject(source);
        const size = bounds.getSize(new Vector3());
        if (size.x <= 0 || size.y <= 0 || size.z <= 0) {
          onError("The model at public/assets/cloud.glb has invalid dimensions.");
          return;
        }

        const cloudPlacements = [
          { x: -5.4, y: 3.3, scale: 1.25 },
          { x: 4.8, y: 5.2, scale: 0.95 },
          { x: 0.5, y: 1.25, scale: 0.75 },
        ];
        for (const [index, placement] of cloudPlacements.entries()) {
          const cloud = makeCloud(
            source,
            placement.x,
            placement.y,
            placement.scale,
            this.cloudHazeTexture,
          );
          this.clouds.push(cloud);
          this.cloudMotion.push({
            x: placement.x,
            y: placement.y,
            z: cloud.position.z,
            scale: cloud.scale.x,
            driftSpeed: 0.08 + placement.scale * 0.08,
            halfWidth: (2.35 * placement.scale) / 2,
            phase: index * 2.1,
          });
        }
        this.scene.add(...this.clouds);
        onReady();
      },
      undefined,
      () => onError("Could not load public/assets/cloud.glb."),
    );
  }

  update(state: GameState, deltaSeconds: number, elapsedSeconds: number): void {
    const delta = Math.min(deltaSeconds, 0.05);
    if (state.mode === "gameover" && !this.playerDeath && !this.playerDeathComplete) {
      const fallsTowardPlayer = this.nextPlayerDeathFallsToward;
      this.nextPlayerDeathFallsToward = !this.nextPlayerDeathFallsToward;
      const targetRotationX = Math.PI * (fallsTowardPlayer ? 110 : -80) / 180;
      const targetRotationY = 0;
      const targetRotationZ = 0;
      this.playerRoot.rotation.set(targetRotationX, targetRotationY, targetRotationZ);
      this.playerRoot.position.set(state.shipX, 0, 0);
      this.playerRoot.updateMatrixWorld(true);
      const landingBounds = new Box3().setFromObject(this.playerRoot);
      const landingCenter = landingBounds.getCenter(new Vector3());
      const landingSize = landingBounds.getSize(new Vector3());
      const targetY = PLAYER_GROUND_Y - landingBounds.min.y;
      landingCenter.y += targetY;
      this.playerDeath = {
        age: 0,
        startX: state.shipX,
        startY: PLAYER_Y,
        targetY,
        dropDuration: fallsTowardPlayer ? 0.54 : 0.42,
        shadowStartX: this.shadow.position.x,
        shadowTargetX: landingCenter.x,
        shadowStartZ: this.shadow.position.z,
        // Bias the floor shadow toward the A's front edge so its dark core remains visible in perspective.
        shadowTargetZ: landingBounds.max.z - landingSize.z * 0.3,
        shadowStartScaleX: this.shadow.scale.x,
        shadowStartScaleY: this.shadow.scale.y,
        shadowTargetScaleX: Math.max(this.shadow.scale.x, (landingSize.x * 1.45) / SHIP_SHADOW_WIDTH),
        shadowTargetScaleY: (landingSize.z * 1.7) / SHIP_SHADOW_DEPTH,
        targetRotationX,
        targetRotationY,
        targetRotationZ,
        dustSpawned: false,
        smokeTimer: 0,
        smokeSeed: (Math.random() * 0xffffffff) >>> 0,
      };
    }
    this.starMaterial.uniforms.uTime!.value = elapsedSeconds;
    this.accentLight.position.set(
      Math.sin(elapsedSeconds * 0.28) * 7,
      1.5 + Math.sin(elapsedSeconds * 0.43) * 2.2,
      6 + Math.cos(elapsedSeconds * 0.31) * 1.5,
    );
    this.accentLight.intensity = 9.5 + Math.sin(elapsedSeconds * 0.7) * 1.5;
    for (const hit of state.shieldHits.splice(0)) this.spawnShieldHitParticles(hit);
    for (const impact of state.groundImpacts.splice(0)) this.spawnGroundSplat(impact);
    this.updateHitParticles(delta);
    this.updateAlienDeaths(delta);

    for (let index = 0; index < this.clouds.length; index += 1) {
      const cloud = this.clouds[index]!;
      const motion = this.cloudMotion[index]!;
      const phase = elapsedSeconds * (0.55 + index * 0.08) + motion.phase;
      motion.x -= motion.driftSpeed * delta;
      if (motion.x < -HALF_WIDTH - motion.halfWidth) {
        motion.x = HALF_WIDTH + motion.halfWidth;
      }
      cloud.position.x = motion.x;
      cloud.position.y = motion.y + Math.sin(phase * 0.8) * 0.12;
      cloud.position.z = motion.z + Math.sin(phase) * 0.22;
      cloud.rotation.x = Math.sin(phase * 0.7) * 0.12;
      cloud.rotation.y = Math.sin(phase) * 0.32;
      cloud.rotation.z = Math.sin(phase * 0.45) * 0.035;
      const breathe = 1 + Math.sin(phase * 0.65) * 0.018;
      cloud.scale.setScalar(motion.scale * breathe);
    }

    const shipDeltaX = state.shipX - this.previousShipX;
    const expectedMaxTravel = 8 * delta;
    const shipVelocity =
      delta > 0 && Math.abs(shipDeltaX) <= expectedMaxTravel + 0.01
        ? shipDeltaX / delta
        : 0;
    this.previousShipX = state.shipX;
    if (state.lives < this.previousLives) {
      this.hitVibration = 0.55;
    }
    this.previousLives = state.lives;

    const turn = Math.max(-1, Math.min(1, shipVelocity / 8));
    const turnBlend = 1 - Math.exp(-12 * delta);
    if (state.playerFireCooldown > this.previousPlayerFireCooldown) {
      this.recoil = 0.22;
      this.muzzleFlash = 1;
    }
    this.previousPlayerFireCooldown = state.playerFireCooldown;
    this.recoil *= Math.exp(-9 * delta);
    this.muzzleFlash = Math.max(0, this.muzzleFlash - delta / MUZZLE_FLASH_SECONDS);
    this.hitVibration = Math.max(0, this.hitVibration - delta);

    const vibration = this.hitVibration / 0.55;
    const shake = Math.sin(elapsedSeconds * 48) * vibration;
    const idleMotion = 1 - Math.min(1, Math.abs(turn));
    const hoverX = Math.sin(elapsedSeconds * 1.35) * 0.045 * idleMotion;
    const hoverY = Math.sin(elapsedSeconds * 2.2) * 0.055 * idleMotion;
    const hoverZ = Math.cos(elapsedSeconds * 1.7) * 0.09 * idleMotion;
    this.playerRoot.position.x = state.shipX + hoverX + shake * 0.18;
    this.playerRoot.position.y =
      PLAYER_Y + hoverY - this.recoil + Math.cos(elapsedSeconds * 43) * vibration * 0.08;
    this.playerRoot.position.z = hoverZ;
    this.playerRoot.rotation.x +=
      (Math.sin(elapsedSeconds * 1.7) * 0.045 * idleMotion - this.playerRoot.rotation.x) *
      turnBlend;
    this.playerRoot.rotation.y +=
      (turn * 0.55 + Math.sin(elapsedSeconds * 1.4) * 0.08 * idleMotion + shake * 0.15 -
        this.playerRoot.rotation.y) *
      turnBlend;
    this.playerRoot.rotation.z +=
      (-turn * 0.12 + Math.sin(elapsedSeconds * 1.1) * 0.04 * idleMotion + shake * 0.11 -
        this.playerRoot.rotation.z) *
      turnBlend;
    this.playerRoot.visible = this.shipLoaded;
    this.updateMuzzleFlare();
    this.updateImpactLights(delta);
    this.shadow.position.set(state.shipX, PLAYER_SHADOW_Y, -0.15);
    const shadowScale = 1 - hoverY * 0.65;
    this.shadow.scale.set(shadowScale, shadowScale, 1);
    this.updatePlayerDeath(delta);

    for (const shield of state.shields) {
      const uniforms = this.shieldDamageUniforms.get(shield.id);
      if (uniforms) setDamageUniforms(uniforms, shield.damageHoles, shield.destroyed);
      const holeWalls = this.shieldHoleWalls.get(shield.id);
      if (holeWalls) {
        holeWalls.count = shield.destroyed
          ? 0
          : Math.min(shield.damageHoles.length, DAMAGE_HOLE_CAPACITY);
      }

      const view = this.shieldViews.get(shield.id);
      if (view) this.updateShieldShadow(shield);
      if (view) {
        const previousHoleCount = this.previousShieldHoleCounts.get(shield.id) ?? 0;
        if (shield.damageHoles.length > previousHoleCount) {
          this.shieldHitShake.set(shield.id, 0.32);
        }
        this.previousShieldHoleCounts.set(shield.id, shield.damageHoles.length);

        const hitShake = this.shieldHitShake.get(shield.id) ?? 0;
        const shakeEnvelope = hitShake / 0.32;
        const shake = Math.sin(elapsedSeconds * 52 + shield.id) * shakeEnvelope;
        this.shieldHitShake.set(shield.id, Math.max(0, hitShake - delta));

        const phase = shield.id * 1.7;
        view.position.z = Math.sin(elapsedSeconds * 1.15 + phase) * 0.08;
        view.position.x = shield.x + shake * 0.035;
        view.position.y = shield.y + Math.cos(elapsedSeconds * 0.9 + phase) * 0.018 +
          Math.cos(elapsedSeconds * 46 + shield.id) * shakeEnvelope * 0.018;
        view.rotation.x =
          Math.sin(elapsedSeconds * 0.9 + phase) * 0.055 + shake * 0.028;
        view.rotation.y =
          Math.cos(elapsedSeconds * 0.72 + phase) * 0.07 + shake * 0.04;
        view.rotation.z =
          Math.sin(elapsedSeconds * 0.65 + phase) * 0.018 + shake * 0.025;
      }
    }

    if (this.alienModels.length === ALIEN_VARIANT_COUNT) {
      const currentEnemyIds = new Set(state.enemies.map((enemy) => enemy.id));
      for (const [id, view] of this.enemyViews) {
        if (!currentEnemyIds.has(id)) {
          this.alienDeaths.push({ view, age: 0 });
          // The binary stream strikes the alien's underside; light it from just below and in front.
          const impact = new Vector3(view.position.x, view.position.y - 0.3, 0.55);
          this.flashImpactLight(impact, "#5fb4d8", ALIEN_HIT_LIGHT_INTENSITY, 0.26, 3.6);
          this.spawnAlienHitFlare(new Vector3(impact.x, impact.y, 0.4));
          this.enemyViews.delete(id);
          this.removeEnemyShadow(id);
        }
      }
      const introProgress = state.formationIntro > 0
        ? 1 - state.formationIntro / FORMATION_INTRO_SECONDS
        : 1;
      for (const enemy of state.enemies) {
        let view = this.enemyViews.get(enemy.id);
        if (!view) {
          const alienModel = this.alienModels[enemy.modelIndex];
          if (!alienModel) throw new Error(`Alien model ${enemy.modelIndex + 1} is not loaded.`);
          view = makeEnemy(alienModel);
          this.enemyViews.set(enemy.id, view);
          this.scene.add(view);
        }
        let enemyShadow = this.enemyShadows.get(enemy.id);
        if (!enemyShadow) {
          enemyShadow = makeAlienShadow(this.shadowTexture);
          this.enemyShadows.set(enemy.id, enemyShadow);
          this.scene.add(enemyShadow);
        }
        const flight = introProgress < 1
          ? formationFlightPose(enemy.id, enemy.x, enemy.y, introProgress)
          : null;
        const x = flight?.x ?? enemy.x;
        const y = flight?.y ?? enemy.y;
        updateAlienShadow(enemyShadow, x, y);
        const phase = enemy.id * 0.83 + enemy.column * 1.37;
        view.position.set(
          x,
          y + Math.sin(elapsedSeconds * 2 + phase) * 0.045,
          (flight?.z ?? 0) + Math.cos(elapsedSeconds * 1.4 + phase) * 0.055,
        );
        view.rotation.x = Math.sin(elapsedSeconds * 1.4 + phase) * 0.045 + (flight?.pitch ?? 0);
        view.rotation.y = Math.cos(elapsedSeconds * 1.1 + phase) * 0.075 + (flight?.yaw ?? 0);
        view.rotation.z = Math.sin(elapsedSeconds * 1.7 + phase) * 0.035 + (flight?.bank ?? 0);
      }
    }

    this.syncPlayerShots(state.playerShots, elapsedSeconds);
    this.syncEnemyBombs(state.enemyShots, elapsedSeconds);
  }

  render(): void {
    this.updateParallax();
    this.renderer.render(this.scene, this.camera);
  }

  resetForRestart(): void {
    for (const view of this.enemyViews.values()) this.scene.remove(view);
    this.enemyViews.clear();
    for (const id of [...this.enemyShadows.keys()]) this.removeEnemyShadow(id);
    for (const death of this.alienDeaths) this.scene.remove(death.view);
    this.alienDeaths.length = 0;
    this.clearHitParticles();
    this.playerDeath = undefined;
    this.playerDeathComplete = false;
    this.playerRoot.visible = this.shipLoaded;
    this.playerRoot.scale.set(1, 1, 1);
    this.playerRoot.rotation.set(0, 0, 0);
    this.camera.position.set(0, CAMERA_HEIGHT, CAMERA_DISTANCE);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.resize();
    this.shadow.visible = true;
    this.shadow.position.set(0, PLAYER_SHADOW_Y, -0.15);
    this.shadow.rotation.set(0, 0, 0);
    this.shadow.scale.set(1, 1, 1);
    this.syncPlayerShots([], 0);
    this.syncEnemyBombs([], 0);
    this.previousShipX = 0;
    this.previousLives = 3;
    this.previousPlayerFireCooldown = 0;
    this.hitVibration = 0;
    this.recoil = 0;
    this.muzzleFlash = 0;
    this.muzzleFlare.visible = false;
    this.muzzleLight.intensity = 0;
    for (const impact of this.impactLights) {
      impact.age = impact.duration;
      impact.light.intensity = 0;
    }
    for (const shieldId of this.shieldHitShake.keys()) this.shieldHitShake.set(shieldId, 0);
    for (const shieldId of this.previousShieldHoleCounts.keys()) {
      this.previousShieldHoleCounts.set(shieldId, 0);
    }
  }

  get isPlayerDeathComplete(): boolean {
    return this.playerDeathComplete;
  }

  dispose(): void {
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("pointerdown", this.handlePointerDown);
    window.removeEventListener("pointerup", this.handlePointerUp);
    window.removeEventListener("pointercancel", this.handlePointerUp);
    window.removeEventListener("pointermove", this.handlePointerMove);
    document.documentElement.removeEventListener("mouseleave", this.resetParallaxTarget);
    window.removeEventListener("blur", this.resetParallaxTarget);
    this.resetForRestart();
    this.renderer.dispose();
    this.fragmentGeometry.dispose();
    this.floorDecalGeometry.dispose();
    this.binaryGlyphGeometry.dispose();
    for (const texture of this.binaryGlyphTextures) texture.dispose();
    this.malwareCubeGeometry.dispose();
    this.malwareFaceTextures.map.dispose();
    this.malwareFaceTextures.emissiveMap.dispose();
    this.hexGlyphGeometry.dispose();
    for (const texture of this.hexGlyphTextures) texture.dispose();
    this.dustTexture.dispose();
    this.muzzleFlareTexture.dispose();
    this.muzzleFlare.material.dispose();
    this.cloudHazeTexture.dispose();
    for (const cloud of this.clouds) {
      cloud.traverse((object) => {
        if (!(object instanceof Mesh || object instanceof Sprite)) return;
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          material.dispose();
        }
      });
    }
  }

  private clearHitParticles(): void {
    for (const particle of this.hitParticles) {
      this.scene.remove(particle.object);
      particle.object.material.dispose();
    }
    this.hitParticles.length = 0;
  }

  private updatePlayerDeath(delta: number): void {
    const death = this.playerDeath;
    if (!death) return;

    death.age += delta;
    const shakeDuration = 0.62;
    const dropDuration = death.dropDuration;
    const dustStart = shakeDuration + dropDuration;
    const totalDuration = dustStart + 0.85;
    const smoothStep = (value: number): number => {
      const clamped = Math.max(0, Math.min(1, value));
      return clamped * clamped * (3 - 2 * clamped);
    };

    this.playerRoot.position.x = death.startX;
    // Pin depth too, otherwise the idle hover keeps bobbing the fallen A.
    this.playerRoot.position.z = 0;
    if (death.age < shakeDuration) {
      const shakeProgress = death.age / shakeDuration;
      const shakeAmount = 1 - shakeProgress;
      this.playerRoot.position.y =
        death.startY + Math.sin(death.age * 52) * 0.035 * shakeAmount;
      this.playerRoot.rotation.x = Math.sin(death.age * 58) * 0.12 * shakeAmount;
      this.playerRoot.rotation.y = Math.sin(death.age * 43) * 0.08 * shakeAmount;
      this.playerRoot.rotation.z = Math.cos(death.age * 47) * 0.06 * shakeAmount;
    } else if (death.age < dustStart) {
      const progress = smoothStep((death.age - shakeDuration) / dropDuration);
      this.playerRoot.position.y = death.startY + (death.targetY - death.startY) * progress;
      this.playerRoot.rotation.x = death.targetRotationX * progress;
      this.playerRoot.rotation.y = death.targetRotationY * progress;
      this.playerRoot.rotation.z = death.targetRotationZ * progress;
    } else {
      this.playerRoot.position.y = death.targetY;
      this.playerRoot.rotation.set(
        death.targetRotationX,
        death.targetRotationY,
        death.targetRotationZ,
      );
    }
    const shadowProgress = smoothStep((death.age - shakeDuration) / dropDuration);
    this.shadow.position.set(
      death.shadowStartX + (death.shadowTargetX - death.shadowStartX) * shadowProgress,
      PLAYER_SHADOW_Y,
      death.shadowStartZ + (death.shadowTargetZ - death.shadowStartZ) * shadowProgress,
    );
    // Lay the contact shadow flat on the floor so perspective spreads it under the whole fallen A.
    this.shadow.rotation.x = (-Math.PI / 2) * shadowProgress;
    this.shadow.scale.set(
      death.shadowStartScaleX + (death.shadowTargetScaleX - death.shadowStartScaleX) * shadowProgress,
      death.shadowStartScaleY + (death.shadowTargetScaleY - death.shadowStartScaleY) * shadowProgress,
      1,
    );

    if (!death.dustSpawned && death.age >= dustStart) {
      death.dustSpawned = true;
      this.spawnPlayerDeathDust(new Vector3(death.startX, PLAYER_GROUND_Y + 0.04, 0.3));
      this.playerRoot.updateMatrixWorld(true);
      death.smokeBounds = new Box3().setFromObject(this.playerRoot);
    }
    if (death.smokeBounds && delta > 0) {
      const smokeAge = death.age - dustStart;
      // Thick smoke right after the crash, settling to a steady smoulder.
      const interval = smokeAge < 1.5 ? 0.045 : 0.1;
      death.smokeTimer -= delta;
      while (death.smokeTimer <= 0) {
        death.smokeTimer += interval;
        this.spawnPlayerSmoke(death, smokeAge < 1.5 ? 1.25 : 1);
      }
    }
    if (death.age >= totalDuration) {
      this.playerDeathComplete = true;
    }
  }

  private spawnPlayerSmoke(death: PlayerDeathAnimation, strength: number): void {
    const bounds = death.smokeBounds;
    if (!bounds) return;
    death.smokeSeed = (death.smokeSeed * 1103515245 + 12345) >>> 0;
    const random = seededRandom(death.smokeSeed);
    const material = new SpriteMaterial({
      map: this.cloudHazeTexture,
      color: SMOKE_COLORS[Math.floor(random() * SMOKE_COLORS.length)]!,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const smoke = new Sprite(material);
    const size = (0.22 + random() * 0.2) * strength;
    smoke.scale.set(size, size, 1);
    // Rise from the upper surface of the wreck, favouring its middle.
    const spread = (random() + random()) / 2;
    smoke.position.set(
      bounds.min.x + (bounds.max.x - bounds.min.x) * spread,
      bounds.max.y - 0.05,
      bounds.min.z + (bounds.max.z - bounds.min.z) * (0.3 + random() * 0.4),
    );
    smoke.material.rotation = random() * Math.PI * 2;
    this.scene.add(smoke);
    this.hitParticles.push({
      object: smoke,
      velocity: new Vector3(
        SMOKE_DRIFT_X + (random() - 0.5) * 0.18,
        0.85 + random() * 0.4,
        (random() - 0.5) * 0.12,
      ),
      angularVelocity: new Vector3(0, 0, (random() - 0.5) * 0.7),
      age: 0,
      lifetime: 3 + random() * 1.6,
      gravity: -0.38,
      initialScale: size,
      kind: "smoke",
    });
  }

  private spawnPlayerDeathDust(center: Vector3): void {
    const random = seededRandom(this.playerRoot.id ^ 0x62d4a91);
    const count = 28 + Math.floor(random() * 9);
    for (let index = 0; index < count; index += 1) {
      const material = new SpriteMaterial({
        map: this.dustTexture,
        color: random() > 0.5 ? "#c6ced3" : "#8898a5",
        transparent: true,
        opacity: 0.68,
        depthWrite: false,
      });
      const dust = new Sprite(material);
      const size = 0.18 + random() * 0.28;
      dust.scale.set(size, size, 1);
      dust.position.copy(center);
      dust.position.x += (random() - 0.5) * 0.5;
      dust.position.y += (random() - 0.5) * 0.28;
      this.scene.add(dust);
      this.hitParticles.push({
        object: dust,
        velocity: new Vector3(
          (random() - 0.5) * 1.8,
          0.25 + random() * 0.9,
          (random() - 0.5) * 0.35,
        ),
        angularVelocity: new Vector3(0, 0, (random() - 0.5) * 1.5),
        age: 0,
        lifetime: 0.7 + random() * 0.55,
        gravity: -0.22,
        initialScale: size,
        kind: "dust",
      });
    }
  }

  private parallaxDragging = false;

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== "mouse") return;
    // Ignore clicks on HUD buttons and overlays so they keep working normally.
    if (event.target instanceof Element && event.target.closest("button, .end-panel, .asset-notice, .splash")) {
      return;
    }
    this.parallaxDragging = true;
    this.handlePointerMove(event);
  };

  private readonly handlePointerUp = (): void => {
    this.parallaxDragging = false;
    this.parallaxTarget.set(0, 0);
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerType !== "mouse" || !this.parallaxDragging) return;
    const x = (event.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
    const y = 1 - (event.clientY / Math.max(1, window.innerHeight)) * 2;
    this.parallaxTarget.set(Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y)));
  };

  private readonly resetParallaxTarget = (): void => {
    this.parallaxDragging = false;
    this.parallaxTarget.set(0, 0);
  };

  private updateParallax(): void {
    const now = performance.now();
    const delta = Math.min(0.1, (now - this.lastParallaxTime) / 1000);
    this.lastParallaxTime = now;
    this.parallaxCurrent.lerp(this.parallaxTarget, 1 - Math.exp(-PARALLAX_EASE * delta));
    this.applyCameraOffset(this.parallaxCurrent.x, this.parallaxCurrent.y);
  }

  private applyCameraOffset(x: number, y: number): void {
    // Shift the eye toward the mouse while still looking at the play field centre,
    // so near objects slide against the far sky and stars.
    this.camera.position.set(x * PARALLAX_X, CAMERA_HEIGHT + y * PARALLAX_Y, CAMERA_DISTANCE);
    this.camera.lookAt(0, 0, 0);
    // The sky gradient is effectively at infinity, so it stays locked to the view.
    this.camera.updateMatrixWorld();
    this.background.quaternion.copy(this.camera.quaternion);
    this.background.position
      .copy(this.camera.position)
      .addScaledVector(this.camera.getWorldDirection(this.backgroundDirection), BACKGROUND_DISTANCE);
  }

  private readonly resize = (): void => {
    // Lay out the far layers from the centred camera; parallax is reapplied each frame.
    this.applyCameraOffset(0, 0);
    const aspect = Math.max(0.4, window.innerWidth / Math.max(1, window.innerHeight));
    // Fit whichever axis is tighter: narrow windows fit the play width, wide windows keep
    // the full height (aliens, HUD, firewalls and the A) and reveal extra sky at the sides.
    const viewHeight = Math.max(WORLD_WIDTH / aspect, MIN_VIEW_HEIGHT);
    this.camera.aspect = aspect;
    this.camera.fov = 2 * Math.atan(viewHeight / (2 * CAMERA_DISTANCE)) * (180 / Math.PI);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
    this.applyCameraOffset(0, 0);
    const backgroundHeight = 2 * BACKGROUND_DISTANCE * Math.tan(this.camera.fov * Math.PI / 360);
    this.background.scale.set(backgroundHeight * aspect, backgroundHeight, 1);
    const context = this.backgroundTexture.image.getContext("2d");
    if (!context) throw new Error("A 2D canvas context is required to resize the background.");
    drawBackground(
      context,
      this.backgroundTexture.image.width,
      this.backgroundTexture.image.height,
      viewHeight,
    );
    this.backgroundTexture.needsUpdate = true;
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    const starPositions = this.stars.geometry.getAttribute("position");
    const starBrightness = this.stars.geometry.getAttribute("aBrightness");
    const random = seededRandom(0x51a7);
    const ray = new Vector3();
    for (let index = 0; index < starPositions.count; index += 1) {
      let screenX: number;
      let height: number;
      if (index < STAR_COUNT) {
        screenX = random() * 2.04 - 1.02;
        // Bias toward the upper sky so stars thin out as they approach the horizon.
        height = Math.sqrt(random());
      } else {
        // Margin stars: uniformly fill the overscan band outside the default view.
        do {
          screenX = (random() * 2 - 1) * PARALLAX_OVERSCAN;
          height = random() * STAR_MARGIN_HEIGHT;
        } while (Math.abs(screenX) < 1.02 && height <= 1);
      }
      const screenY = STAR_LOWEST_SCREEN_Y + height * (1.02 - STAR_LOWEST_SCREEN_Y);
      ray.set(screenX, screenY, 0.5).unproject(this.camera).sub(this.camera.position);
      const distance = (STAR_PLANE_Z - this.camera.position.z) / ray.z;
      starPositions.setXYZ(
        index,
        this.camera.position.x + ray.x * distance,
        this.camera.position.y + ray.y * distance,
        0,
      );
      starBrightness.setX(index, 0.35 + 0.65 * Math.min(1, height * 1.4));
    }
    starPositions.needsUpdate = true;
    starBrightness.needsUpdate = true;
    this.starMaterial.uniforms.uPixelScale!.value =
      (window.innerHeight / viewHeight) * this.renderer.getPixelRatio();
  };

  private updateMuzzleFlare(): void {
    const active = this.muzzleFlash > 0 && this.playerRoot.visible && !this.playerDeath;
    this.muzzleFlare.visible = active;
    if (!active) {
      this.muzzleLight.intensity = 0;
      return;
    }
    this.playerRoot.updateMatrixWorld();
    const apex = this.playerRoot.localToWorld(new Vector3(0, PLAYER_MUZZLE_OFFSET, 0));
    // Ease-out so the flare pops instantly and fades quickly.
    const flash = this.muzzleFlash * this.muzzleFlash;
    this.muzzleFlare.position.copy(apex).add(new Vector3(0, 0.05, 0.25));
    this.muzzleFlare.scale.setScalar(0.45 + (1 - this.muzzleFlash) * 0.5);
    this.muzzleFlare.material.opacity = this.muzzleFlash;
    this.muzzleFlare.material.rotation = this.muzzleFlash * 0.6;
    // Light sits above the tip (barely forward) so it lights the A's top faces and only grazes the front.
    this.muzzleLight.position.copy(apex).add(new Vector3(0, 0.5, 0.08));
    this.muzzleLight.intensity = MUZZLE_LIGHT_INTENSITY * flash;
  }

  private syncPlayerShots(projectiles: Projectile[], elapsedSeconds: number): void {
    const currentIds = new Set(projectiles.map((projectile) => projectile.id));
    for (const [id, view] of this.playerShotViews) {
      if (currentIds.has(id)) continue;
      this.scene.remove(view);
      for (const glyph of view.children) {
        ((glyph as Mesh).material as MeshBasicMaterial).dispose();
      }
      this.playerShotViews.delete(id);
    }
    const flickerStep = Math.floor(elapsedSeconds / BINARY_FLICKER_SECONDS);
    for (const projectile of projectiles) {
      let view = this.playerShotViews.get(projectile.id);
      if (!view) {
        view = makeBinaryStream(
          this.binaryGlyphGeometry,
          this.binaryGlyphTextures,
          projectile.id * 7919 + 17,
        );
        this.playerShotViews.set(projectile.id, view);
        this.scene.add(view);
      }
      view.position.set(projectile.x, projectile.y, BOMB_DEPTH);
      const muzzleY = PLAYER_Y + PLAYER_MUZZLE_OFFSET - 0.02;
      view.children.forEach((glyph, index) => {
        // Trailing digits stay hidden until they clear the A's tip, so the stream emerges from it.
        glyph.visible = projectile.y - index * BINARY_GLYPH_SPACING >= muzzleY;
        const bits = Math.sin((projectile.id * 31 + index * 7 + flickerStep) * 12.9898) * 43758.5453;
        if (bits - Math.floor(bits) < 0.35) {
          const material = (glyph as Mesh).material as MeshBasicMaterial;
          material.map = this.binaryGlyphTextures[bits * 10 - Math.floor(bits * 10) < 0.5 ? 0 : 1];
        }
      });
    }
  }

  private syncEnemyBombs(projectiles: Projectile[], elapsedSeconds: number): void {
    const currentIds = new Set(projectiles.map((projectile) => projectile.id));
    for (const [id, view] of this.enemyShotViews) {
      if (currentIds.has(id)) continue;
      this.scene.remove(view);
      for (const child of view.children) ((child as Mesh).material as Material).dispose();
      this.enemyShotViews.delete(id);
    }
    const flickerStep = Math.floor(elapsedSeconds / BINARY_FLICKER_SECONDS);
    for (const projectile of projectiles) {
      let view = this.enemyShotViews.get(projectile.id);
      if (!view) {
        view = makeMalwareBomb(
          this.malwareCubeGeometry,
          this.malwareFaceTextures,
          this.hexGlyphGeometry,
          this.hexGlyphTextures,
          projectile.id * 7919 + 31,
        );
        this.enemyShotViews.set(projectile.id, view);
        this.scene.add(view);
      }
      view.position.set(projectile.x, projectile.y, BOMB_DEPTH);
      const [cube, ...glyphs] = view.children as Mesh[];
      if (!cube) continue;
      const { spinAxis, spinSpeed, spinOffset } = cube.userData as {
        spinAxis: Vector3;
        spinSpeed: number;
        spinOffset: number;
      };
      cube.quaternion.setFromAxisAngle(spinAxis, spinOffset + elapsedSeconds * spinSpeed);
      (cube.material as MeshStandardMaterial).emissiveIntensity =
        0.8 + Math.sin(elapsedSeconds * 9 + spinOffset) * 0.2;
      glyphs.forEach((glyph, index) => {
        const noise = Math.sin((projectile.id * 53 + index * 11 + flickerStep) * 12.9898) * 43758.5453;
        const roll = noise - Math.floor(noise);
        const material = glyph.material as MeshBasicMaterial;
        if (roll < 0.3) {
          material.map = this.hexGlyphTextures[Math.floor(roll * 100) % this.hexGlyphTextures.length]!;
        }
        // Glitch: brief sideways tears and occasional bright flashes.
        glyph.position.x = roll > 0.82 ? (roll - 0.91) * 0.9 : 0;
        material.opacity = (roll > 0.94 ? 0.8 : 0.65) - index * 0.18;
      });
    }
  }

  private spawnShieldHitParticles(hit: ShieldHit): void {
    const random = seededRandom(hit.seed);
    const center = new Vector3(hit.x, hit.y, 0.2);
    const fragmentCount = 4 + Math.floor(random() * 3);

    for (let index = 0; index < fragmentCount; index += 1) {
      const material = new MeshStandardMaterial({
        color: SHIELD_CHUNK_COLORS[Math.floor(random() * SHIELD_CHUNK_COLORS.length)]!,
        roughness: 0.8,
        transparent: true,
        depthWrite: false,
      });
      const fragment = new Mesh(this.fragmentGeometry, material);
      const size = 0.16 + random() * 0.14;
      fragment.scale.set(size * (0.7 + random() * 0.8), size, size * (0.55 + random() * 0.8));
      fragment.position.copy(center);
      fragment.position.x += (random() - 0.5) * 0.12;
      fragment.position.y += (random() - 0.5) * 0.12;
      fragment.castShadow = true;
      this.scene.add(fragment);
      const angle = random() * Math.PI * 2;
      const speed = 0.8 + random() * 2.1;
      this.hitParticles.push({
        object: fragment,
        velocity: new Vector3(
          Math.cos(angle) * speed,
          Math.sin(angle) * speed + 0.45,
          (random() - 0.5) * 1.2,
        ),
        angularVelocity: new Vector3(
          (random() - 0.5) * 18,
          (random() - 0.5) * 18,
          (random() - 0.5) * 18,
        ),
        age: 0,
        lifetime: 0.5 + random() * 0.42,
        gravity: 5.8,
        initialScale: size,
        kind: "fragment",
      });
    }

    const dustCount = 14 + Math.floor(random() * 9);
    for (let index = 0; index < dustCount; index += 1) {
      const material = new SpriteMaterial({
        map: this.dustTexture,
        color: random() > 0.55 ? "#d8c4bc" : "#b8a5a1",
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
      });
      const dust = new Sprite(material);
      const size = 0.09 + random() * 0.12;
      dust.scale.set(size, size, 1);
      dust.position.copy(center);
      dust.position.x += (random() - 0.5) * 0.12;
      dust.position.y += (random() - 0.5) * 0.12;
      dust.position.z += 0.03;
      this.scene.add(dust);
      this.hitParticles.push({
        object: dust,
        velocity: new Vector3((random() - 0.5) * 1.4, 0.15 + random() * 0.85, -0.2 - random() * 0.5),
        angularVelocity: new Vector3(0, 0, (random() - 0.5) * 2),
        age: 0,
        lifetime: 0.5 + random() * 0.4,
        gravity: -0.25,
        initialScale: size,
        kind: "dust",
      });
    }
  }

  private spawnGroundSplat(impact: GroundImpact): void {
    const random = seededRandom(impact.seed);
    const center = new Vector3(impact.x, GROUND_Y, BOMB_DEPTH);

    // Flat floor decals: a lingering scorch plus a bright red flash that spreads out.
    const decals: { kind: "scorch" | "splat"; size: number; lifetime: number }[] = [
      { kind: "scorch", size: 0.9 + random() * 0.25, lifetime: 1.4 },
      { kind: "splat", size: 0.55 + random() * 0.2, lifetime: 0.38 },
    ];
    for (const decal of decals) {
      const material = new MeshBasicMaterial({
        map: decal.kind === "scorch" ? this.shadowTexture : this.dustTexture,
        color: decal.kind === "scorch" ? "#1a0508" : "#ff5d52",
        transparent: true,
        depthWrite: false,
        blending: decal.kind === "splat" ? AdditiveBlending : NormalBlending,
      });
      const mesh = new Mesh(this.floorDecalGeometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = random() * Math.PI * 2;
      mesh.position.copy(center);
      mesh.position.y += decal.kind === "scorch" ? 0.005 : 0.01;
      mesh.renderOrder = -1;
      mesh.scale.set(decal.size, decal.size, 1);
      this.scene.add(mesh);
      this.hitParticles.push({
        object: mesh,
        velocity: new Vector3(),
        angularVelocity: new Vector3(),
        age: 0,
        lifetime: decal.lifetime,
        gravity: 0,
        initialScale: decal.size,
        kind: decal.kind,
      });
    }

    const dropletCount = 9 + Math.floor(random() * 5);
    for (let index = 0; index < dropletCount; index += 1) {
      const material = new MeshStandardMaterial({
        // Red malware shards with amber flecks to echo the bomb's warning emblem.
        color: random() > 0.3 ? "#ff7b72" : "#c98a3e",
        emissive: "#ff352f",
        emissiveIntensity: 1.2,
        roughness: 0.3,
        transparent: true,
        depthWrite: false,
      });
      const droplet = new Mesh(this.fragmentGeometry, material);
      const size = 0.045 + random() * 0.06;
      droplet.scale.setScalar(size);
      droplet.position.copy(center);
      droplet.position.y += 0.05;
      droplet.castShadow = true;
      this.scene.add(droplet);
      const angle = random() * Math.PI * 2;
      const spread = 0.9 + random() * 1.6;
      this.hitParticles.push({
        object: droplet,
        velocity: new Vector3(
          Math.cos(angle) * spread,
          1.6 + random() * 2.4,
          Math.sin(angle) * spread * 0.8,
        ),
        angularVelocity: new Vector3(
          (random() - 0.5) * 20,
          (random() - 0.5) * 20,
          (random() - 0.5) * 20,
        ),
        age: 0,
        lifetime: 0.5 + random() * 0.35,
        gravity: 11,
        initialScale: size,
        kind: "spark",
        bounce: true,
      });
    }

    const dustCount = 8 + Math.floor(random() * 5);
    for (let index = 0; index < dustCount; index += 1) {
      const size = 0.14 + random() * 0.14;
      const dust = new Sprite(new SpriteMaterial({
        map: this.dustTexture,
        color: random() > 0.5 ? "#c9b3b3" : "#8fa6b8",
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
      }));
      dust.scale.set(size, size, 1);
      dust.position.copy(center);
      dust.position.x += (random() - 0.5) * 0.25;
      dust.position.y += 0.08;
      this.scene.add(dust);
      this.hitParticles.push({
        object: dust,
        velocity: new Vector3((random() - 0.5) * 1.6, 0.25 + random() * 0.7, (random() - 0.5) * 0.6),
        angularVelocity: new Vector3(0, 0, (random() - 0.5) * 2),
        age: 0,
        lifetime: 0.55 + random() * 0.35,
        gravity: -0.2,
        initialScale: size,
        kind: "dust",
      });
    }
  }

  private updateHitParticles(delta: number): void {
    for (let index = this.hitParticles.length - 1; index >= 0; index -= 1) {
      const particle = this.hitParticles[index]!;
      particle.age += delta;
      if (particle.age >= particle.lifetime) {
        this.scene.remove(particle.object);
        particle.object.material.dispose();
        this.hitParticles.splice(index, 1);
        continue;
      }

      particle.velocity.y -= particle.gravity * delta;
      particle.velocity.multiplyScalar(Math.exp(-0.6 * delta));
      particle.object.position.addScaledVector(particle.velocity, delta);
      if (particle.bounce && particle.object.position.y < GROUND_Y + 0.03) {
        particle.object.position.y = GROUND_Y + 0.03;
        particle.velocity.y = Math.abs(particle.velocity.y) * 0.35;
        particle.velocity.x *= 0.6;
        particle.velocity.z *= 0.6;
      }
      particle.object.rotation.x += particle.angularVelocity.x * delta;
      particle.object.rotation.y += particle.angularVelocity.y * delta;
      particle.object.rotation.z += particle.angularVelocity.z * delta;
      const life = particle.age / particle.lifetime;
      const material = particle.object.material;
      const baseOpacity = {
        dust: 0.58,
        spark: 1,
        fragment: 0.92,
        splat: 1,
        scorch: 0.6,
        smoke: 0.5,
      }[particle.kind];
      if (particle.kind === "smoke") {
        // Fade in quickly, then thin out as it rises and spreads.
        material.opacity = baseOpacity * Math.min(1, life * 6) * (1 - life) ** 1.4;
        const size = particle.initialScale * (1 + life * 3.4);
        particle.object.scale.set(size, size, 1);
        if (particle.object instanceof Sprite) {
          particle.object.material.rotation += particle.angularVelocity.z * delta;
        }
        continue;
      }
      material.opacity = particle.kind === "scorch"
        ? baseOpacity * (1 - life * life)
        : baseOpacity * (1 - life);

      if (particle.kind === "dust") {
        const size = particle.initialScale * (1 + life * 2.4);
        particle.object.scale.set(size, size, 1);
      } else if (particle.kind === "splat") {
        const size = particle.initialScale * (1 + Math.sqrt(life) * 1.8);
        particle.object.scale.set(size, size, 1);
      } else if (particle.kind === "scorch") {
        const size = particle.initialScale * (0.6 + Math.min(1, life * 6) * 0.4);
        particle.object.scale.set(size, size, 1);
      } else {
        particle.object.scale.multiplyScalar(Math.exp(-0.45 * delta));
      }
    }
  }

  private updateShieldShadow(shield: GameState["shields"][number]): void {
    let shadow = this.shieldShadows.get(shield.id);
    if (!shadow) {
      shadow = makeShieldShadow();
      this.shieldShadows.set(shield.id, shadow);
      this.scene.add(shadow.mesh);
    }
    if (shadow.holeCount !== shield.damageHoles.length || shadow.destroyed !== shield.destroyed) {
      shadow.holeCount = shield.damageHoles.length;
      shadow.destroyed = shield.destroyed;
      drawShieldShadow(shadow, shield);
    }
    shadow.mesh.visible = !shield.destroyed;
    shadow.mesh.position.set(shield.x, PLAYER_SHADOW_Y + ROW_SHADOW_LIFT, -0.25);
  }

  private removeEnemyShadow(id: number): void {
    const shadow = this.enemyShadows.get(id);
    if (!shadow) return;
    this.scene.remove(shadow);
    shadow.geometry.dispose();
    (shadow.material as MeshBasicMaterial).dispose();
    this.enemyShadows.delete(id);
  }

  private updateAlienDeaths(delta: number): void {
    const spinDuration = 0.24;
    for (let index = this.alienDeaths.length - 1; index >= 0; index -= 1) {
      const death = this.alienDeaths[index]!;
      death.age += delta;
      const progress = Math.min(1, death.age / spinDuration);
      death.view.rotation.z += (Math.PI * 2 * 3.2 / spinDuration) * delta;
      death.view.rotation.x += 8 * delta;
      death.view.rotation.y += 5 * delta;
      death.view.scale.setScalar(1 - progress * 0.48);
      if (death.age < spinDuration) continue;

      const center = death.view.position.clone();
      center.z = 0.3;
      this.scene.remove(death.view);
      this.spawnAlienBurst(center, death.view.id);
      this.flashImpactLight(
        new Vector3(center.x, center.y, 0.9),
        "#e0b88a",
        ALIEN_BURST_LIGHT_INTENSITY,
        0.38,
        5.5,
      );
      this.alienDeaths.splice(index, 1);
    }
  }

  private flashImpactLight(
    position: Vector3,
    color: string,
    peak: number,
    duration: number,
    range: number,
  ): void {
    // Reuse whichever pooled light is closest to finishing so new hits always flash.
    let slot = this.impactLights[0]!;
    for (const candidate of this.impactLights) {
      if (candidate.age / candidate.duration > slot.age / slot.duration) slot = candidate;
    }
    slot.light.position.copy(position);
    slot.light.color.set(color);
    slot.light.distance = range;
    slot.age = 0;
    slot.duration = duration;
    slot.peak = peak;
  }

  private updateImpactLights(delta: number): void {
    for (const impact of this.impactLights) {
      impact.age += delta;
      const remaining = Math.max(0, 1 - impact.age / impact.duration);
      impact.light.intensity = impact.peak * remaining * remaining;
    }
  }

  private spawnAlienHitFlare(center: Vector3): void {
    const material = new SpriteMaterial({
      map: this.muzzleFlareTexture,
      // Tinted down so the additive flash sits with the game's muted palette.
      color: "#4f7f9f",
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const flare = new Sprite(material);
    flare.position.copy(center);
    flare.scale.setScalar(0.6);
    flare.renderOrder = 3;
    this.scene.add(flare);
    this.hitParticles.push({
      object: flare,
      velocity: new Vector3(),
      angularVelocity: new Vector3(),
      age: 0,
      lifetime: 0.24,
      gravity: 0,
      initialScale: 0.6,
      kind: "splat",
    });
  }

  private spawnAlienBurst(center: Vector3, seed: number): void {
    const random = seededRandom(seed ^ 0x5a17c9);
    const sparkColors = ["#4fb3d1", "#7cc4d6", "#c9a462", "#c46a8c"];
    const sparkCount = 18 + Math.floor(random() * 7);
    for (let index = 0; index < sparkCount; index += 1) {
      const material = new MeshStandardMaterial({
        color: sparkColors[Math.floor(random() * sparkColors.length)]!,
        emissive: "#2f86b0",
        emissiveIntensity: 0.9,
        roughness: 0.35,
        transparent: true,
        depthWrite: false,
      });
      const spark = new Mesh(this.fragmentGeometry, material);
      const size = 0.035 + random() * 0.055;
      spark.scale.set(size * 1.3, size, size);
      spark.position.copy(center);
      this.scene.add(spark);

      const angle = random() * Math.PI * 2;
      const speed = 1.5 + random() * 3.1;
      const verticalBias = (random() - 0.25) * 1.5;
      this.hitParticles.push({
        object: spark,
        velocity: new Vector3(
          Math.cos(angle) * speed,
          Math.sin(angle) * speed + verticalBias,
          (random() - 0.5) * 1.8,
        ),
        angularVelocity: new Vector3(
          (random() - 0.5) * 24,
          (random() - 0.5) * 24,
          (random() - 0.5) * 24,
        ),
        age: 0,
        lifetime: 0.48 + random() * 0.42,
        gravity: 1.1,
        initialScale: size,
        kind: "spark",
      });
    }

    const dustCount = 12 + Math.floor(random() * 7);
    for (let index = 0; index < dustCount; index += 1) {
      const size = 0.1 + random() * 0.13;
      const dust = new Sprite(new SpriteMaterial({
        map: this.dustTexture,
        color: random() > 0.5 ? "#b9d7e8" : "#d4dce3",
        transparent: true,
        opacity: 0.62,
        depthWrite: false,
      }));
      dust.scale.set(size, size, 1);
      dust.position.copy(center);
      dust.position.x += (random() - 0.5) * 0.12;
      dust.position.y += (random() - 0.5) * 0.12;
      this.scene.add(dust);
      this.hitParticles.push({
        object: dust,
        velocity: new Vector3(
          (random() - 0.5) * 1.6,
          (random() - 0.15) * 1.1,
          -0.2 - random() * 0.6,
        ),
        angularVelocity: new Vector3(0, 0, (random() - 0.5) * 2),
        age: 0,
        lifetime: 0.6 + random() * 0.4,
        gravity: -0.18,
        initialScale: size,
        kind: "dust",
      });
    }

  }
}
