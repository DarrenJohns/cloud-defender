import {
  AmbientLight,
  AdditiveBlending,
  BufferGeometry,
  Box3,
  BoxGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  Matrix4,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OrthographicCamera,
  PCFSoftShadowMap,
  PlaneGeometry,
  PointLight,
  Points,
  Scene,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  Vector4,
  WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { DamageHole, GameState, Projectile, ShieldHit } from "./gameLogic";
import { PLAYER_Y, SHIELD_HEIGHT, SHIELD_WIDTH, SHIELD_Y, WORLD_WIDTH } from "./gameLogic";

const HALF_WIDTH = WORLD_WIDTH / 2;
const ENEMY_COLORS = ["#71d7ff", "#b6a5ff", "#6ff0d0"];
const DAMAGE_HOLE_CAPACITY = 64;
const SHIELD_CHUNK_COLORS = ["#e13d48", "#fa606a", "#9e202d"];

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
  object: Mesh<IcosahedronGeometry, MeshStandardMaterial> | Sprite;
  velocity: Vector3;
  angularVelocity: Vector3;
  age: number;
  lifetime: number;
  gravity: number;
  initialScale: number;
  kind: "fragment" | "dust";
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

function makeStarField(): { points: Points; material: ShaderMaterial } {
  const geometry = new BufferGeometry();
  const random = seededRandom(0x51a7);
  const count = 64;
  geometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute(
    "aSize",
    new Float32BufferAttribute(Array.from({ length: count }, () => 0.025 + random() * 0.035), 1),
  );
  geometry.setAttribute(
    "aPhase",
    new Float32BufferAttribute(Array.from({ length: count }, () => random() * Math.PI * 2), 1),
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
      uniform float uTime;
      uniform float uPixelScale;
      varying float vTwinkle;
      void main() {
        float speed = 0.7 + fract(aPhase * 0.37) * 1.5;
        vTwinkle = 0.25 + 0.75 * (0.5 + 0.5 * sin(uTime * speed + aPhase));
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        gl_PointSize = aSize * uPixelScale * (0.75 + vTwinkle * 0.5);
      }
    `,
    fragmentShader: `
      varying float vTwinkle;
      void main() {
        float distanceFromCenter = length(gl_PointCoord - vec2(0.5));
        float core = 1.0 - smoothstep(0.08, 0.32, distanceFromCenter);
        float glow = 1.0 - smoothstep(0.12, 0.5, distanceFromCenter);
        float alpha = (core * 0.75 + glow * 0.25) * vTwinkle;
        gl_FragColor = vec4(vec3(0.67, 0.84, 1.0), alpha);
      }
    `,
  });
  const points = new Points(geometry, material);
  points.position.z = -9.4;
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
  material.opacity *= 0.58;
  if ("color" in material && material.color instanceof Color) {
    material.color.lerp(new Color("#c9e6ff"), 0.62);
  }
  if (material instanceof MeshStandardMaterial) {
    material.roughness = 0.9;
    material.metalness = 0;
    material.emissive.set("#7ebeff");
    material.emissiveIntensity = 0.12;
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
    color: "#c4e2ff",
    transparent: true,
    opacity: 0.22,
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
        `,
      )
      .replace(
        "#include <color_fragment>",
        `for (int i = 0; i < ${DAMAGE_HOLE_CAPACITY}; i++) {
          vec4 hole = damageHoles[i];
          if (hole.z > 0.0) {
            vec2 offset = vShieldPosition.xy - hole.xy;
            float angle = atan(offset.y, offset.x);
            float edge = hole.z * (
              0.8 +
              0.14 * sin(angle * 2.0 + hole.w) +
              0.08 * sin(angle * 4.0 - hole.w * 1.31) +
              0.025 * sin(angle * 7.0 + hole.w * 2.1)
            );
            float distanceToCenter = length(offset);
            if (distanceToCenter < edge * 0.74) discard;

            if (distanceToCenter < edge) {
              float rim = (distanceToCenter - edge * 0.74) / (edge * 0.26);
              float lightSide = 0.5 + 0.5 * cos(angle - 2.35);
              vec3 innerWall = mix(
                vec3(0.035, 0.012, 0.018),
                vec3(0.78, 0.30, 0.32),
                lightSide * 0.58
              );
              float bevelLight = smoothstep(0.0, 0.28, rim) *
                (1.0 - smoothstep(0.72, 1.0, rim));
              diffuseColor.rgb = mix(innerWall, diffuseColor.rgb, bevelLight * 0.72);
            }
          }
        }
        #include <color_fragment>
        `,
      );
  };
  material.customProgramCacheKey = () => "firewall-mode-a-erosion-v1";
  material.needsUpdate = true;
  return material;
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
    new PlaneGeometry(2.6, 0.38),
    new MeshBasicMaterial({
      map: new CanvasTexture(canvas),
      transparent: true,
      depthWrite: false,
    }),
  );
  shadow.position.set(0, PLAYER_Y - 1, -0.15);
  return shadow;
}

function makeEnemy(index: number): Group {
  const enemy = new Group();
  const color = new Color(ENEMY_COLORS[index % ENEMY_COLORS.length]!);
  const bodyMaterial = new MeshStandardMaterial({
    color,
    roughness: 0.34,
    metalness: 0.14,
    emissive: color,
    emissiveIntensity: 0.16,
  });
  const darkMaterial = new MeshStandardMaterial({
    color: "#18253e",
    roughness: 0.4,
    metalness: 0.2,
  });
  const body = new Mesh(new SphereGeometry(0.38, 20, 14), bodyMaterial);
  body.scale.set(1.22, 0.75, 0.68);
  enemy.add(body);

  const wingGeometry = new BoxGeometry(0.35, 0.13, 0.28);
  for (const side of [-1, 1]) {
    const wing = new Mesh(wingGeometry, bodyMaterial);
    wing.position.set(side * 0.48, -0.08, 0);
    wing.rotation.z = side * -0.18;
    enemy.add(wing);
  }

  const eye = new Mesh(new SphereGeometry(0.09, 12, 8), darkMaterial);
  eye.position.set(0, 0.06, 0.27);
  enemy.add(eye);
  enemy.traverse((object) => {
    if (object instanceof Mesh) object.castShadow = true;
  });
  return enemy;
}

function makeProjectile(enemy: boolean): Mesh {
  const material = new MeshStandardMaterial({
    color: enemy ? "#ff7b72" : "#70e4ff",
    emissive: enemy ? "#ff352f" : "#16b9ff",
    emissiveIntensity: 1.3,
    roughness: 0.25,
  });
  const shot = new Mesh(new SphereGeometry(enemy ? 0.12 : 0.1, 12, 10), material);
  shot.scale.y = enemy ? 1.55 : 1.8;
  return shot;
}

export class GameScene {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(-HALF_WIDTH, HALF_WIDTH, 8, -8, 0.1, 100);
  private readonly background: Mesh;
  private readonly backgroundTexture: CanvasTexture;
  private readonly stars: Points;
  private readonly starMaterial: ShaderMaterial;
  private readonly clouds: Group[] = [];
  private readonly cloudMotion: CloudMotion[] = [];
  private readonly cloudHazeTexture: CanvasTexture;
  private readonly accentLight = new PointLight("#54bfff", 12, 18, 2);
  private readonly shadow: Mesh;
  private readonly playerRoot = new Group();
  private readonly shieldViews = new Map<number, Group>();
  private readonly shieldDamageUniforms = new Map<number, Vector4[]>();
  private readonly shieldHitShake = new Map<number, number>();
  private readonly previousShieldHoleCounts = new Map<number, number>();
  private readonly enemyViews = new Map<number, Group>();
  private readonly playerShotViews = new Map<number, Mesh>();
  private readonly enemyShotViews = new Map<number, Mesh>();
  private readonly hitParticles: HitParticle[] = [];
  private readonly fragmentGeometry = new IcosahedronGeometry(1, 0);
  private readonly dustTexture: CanvasTexture;
  private readonly loader = new GLTFLoader();
  private shipLoaded = false;
  private previousShipX = 0;
  private previousLives = 3;
  private hitVibration = 0;
  private previousPlayerFireCooldown = 0;
  private recoil = 0;

  constructor(container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.outputColorSpace = "srgb";
    this.dustTexture = createDustTexture();
    this.cloudHazeTexture = createCloudHazeTexture();
    container.append(this.renderer.domElement);
    this.camera.position.z = 20;
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

    this.shadow = makeShipShadow();
    this.scene.add(this.shadow, this.playerRoot);
    this.resize();
    window.addEventListener("resize", this.resize);
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
    this.starMaterial.uniforms.uTime!.value = elapsedSeconds;
    this.accentLight.position.set(
      Math.sin(elapsedSeconds * 0.28) * 7,
      1.5 + Math.sin(elapsedSeconds * 0.43) * 2.2,
      6 + Math.cos(elapsedSeconds * 0.31) * 1.5,
    );
    this.accentLight.intensity = 9.5 + Math.sin(elapsedSeconds * 0.7) * 1.5;
    for (const hit of state.shieldHits.splice(0)) this.spawnShieldHitParticles(hit);
    this.updateHitParticles(delta);

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
    }
    this.previousPlayerFireCooldown = state.playerFireCooldown;
    this.recoil *= Math.exp(-9 * delta);
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
    this.shadow.position.x = state.shipX;
    const shadowScale = 1 - hoverY * 0.65;
    this.shadow.scale.set(shadowScale, shadowScale, 1);

    for (const shield of state.shields) {
      const uniforms = this.shieldDamageUniforms.get(shield.id);
      if (uniforms) setDamageUniforms(uniforms, shield.damageHoles, shield.destroyed);

      const view = this.shieldViews.get(shield.id);
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

    const currentEnemyIds = new Set(state.enemies.map((enemy) => enemy.id));
    for (const [id, view] of this.enemyViews) {
      if (!currentEnemyIds.has(id)) {
        this.scene.remove(view);
        this.enemyViews.delete(id);
      }
    }
    for (const enemy of state.enemies) {
      let view = this.enemyViews.get(enemy.id);
      if (!view) {
        view = makeEnemy(enemy.row);
        this.enemyViews.set(enemy.id, view);
        this.scene.add(view);
      }
      view.position.set(enemy.x, enemy.y, 0);
      view.rotation.z = Math.sin(elapsedSeconds * 3 + enemy.column) * 0.055;
    }

    this.syncProjectiles(state.playerShots, this.playerShotViews, false);
    this.syncProjectiles(state.enemyShots, this.enemyShotViews, true);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    window.removeEventListener("resize", this.resize);
    for (const particle of this.hitParticles) {
      this.scene.remove(particle.object);
      particle.object.material.dispose();
    }
    this.hitParticles.length = 0;
    this.renderer.dispose();
    this.fragmentGeometry.dispose();
    this.dustTexture.dispose();
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

  private readonly resize = (): void => {
    const aspect = Math.max(0.4, window.innerWidth / Math.max(1, window.innerHeight));
    const viewHeight = WORLD_WIDTH / aspect;
    this.camera.left = -HALF_WIDTH;
    this.camera.right = HALF_WIDTH;
    this.camera.top = viewHeight / 2;
    this.camera.bottom = -viewHeight / 2;
    this.camera.updateProjectionMatrix();
    this.background.scale.set(WORLD_WIDTH, viewHeight, 1);
    this.background.position.y = 0;
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
    const random = seededRandom(0x51a7);
    for (let index = 0; index < starPositions.count; index += 1) {
      starPositions.setXYZ(
        index,
        (random() * 2 - 1) * HALF_WIDTH,
        viewHeight * (0.24 + random() * 0.25),
        0,
      );
    }
    starPositions.needsUpdate = true;
    this.starMaterial.uniforms.uPixelScale!.value =
      (window.innerHeight / viewHeight) * this.renderer.getPixelRatio();
  };

  private syncProjectiles(
    projectiles: Projectile[],
    views: Map<number, Mesh>,
    enemy: boolean,
  ): void {
    const currentIds = new Set(projectiles.map((projectile) => projectile.id));
    for (const [id, view] of views) {
      if (!currentIds.has(id)) {
        this.scene.remove(view);
        views.delete(id);
      }
    }
    for (const projectile of projectiles) {
      let view = views.get(projectile.id);
      if (!view) {
        view = makeProjectile(enemy);
        views.set(projectile.id, view);
        this.scene.add(view);
      }
      view.position.set(projectile.x, projectile.y, 0.2);
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
      particle.object.rotation.x += particle.angularVelocity.x * delta;
      particle.object.rotation.y += particle.angularVelocity.y * delta;
      particle.object.rotation.z += particle.angularVelocity.z * delta;
      const life = particle.age / particle.lifetime;
      const material = particle.object.material;
      material.opacity = (particle.kind === "dust" ? 0.58 : 0.92) * (1 - life);

      if (particle.kind === "dust") {
        const size = particle.initialScale * (1 + life * 2.4);
        particle.object.scale.set(size, size, 1);
      } else {
        particle.object.scale.multiplyScalar(Math.exp(-0.45 * delta));
      }
    }
  }
}
