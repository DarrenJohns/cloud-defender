import {
  AmbientLight,
  Box3,
  BoxGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  OrthographicCamera,
  PCFSoftShadowMap,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { GameState, Projectile } from "./gameLogic";
import { PLAYER_Y, WORLD_WIDTH } from "./gameLogic";

const HALF_WIDTH = WORLD_WIDTH / 2;
const ENEMY_COLORS = ["#71d7ff", "#b6a5ff", "#6ff0d0"];

function makeGradientMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    depthWrite: false,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      void main() {
        vec3 night = vec3(0.024, 0.055, 0.11);
        vec3 horizon = vec3(0.10, 0.22, 0.39);
        float glow = 1.0 - smoothstep(0.02, 0.68, vUv.y);
        vec3 color = mix(night, horizon, glow * 0.88);
        color += vec3(0.035, 0.08, 0.13) * (1.0 - vUv.y);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
}

function makeCloud(x: number, y: number, scale: number): Group {
  const cloud = new Group();
  const material = new MeshStandardMaterial({
    color: "#b8d8f8",
    roughness: 0.95,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
  });
  const puffs = [
    [-0.55, 0, 0, 0.55],
    [-0.1, 0.18, 0, 0.72],
    [0.45, 0, 0, 0.53],
    [0.05, -0.08, 0.01, 0.58],
  ];
  for (const [px, py, pz, radius] of puffs) {
    const puff = new Mesh(new SphereGeometry(radius, 16, 12), material);
    puff.position.set(px!, py!, pz!);
    puff.scale.y = 0.62;
    cloud.add(puff);
  }
  cloud.position.set(x, y, -4.4);
  cloud.scale.setScalar(scale);
  return cloud;
}

function addFirewallBases(scene: Scene): void {
  const mortar = new MeshStandardMaterial({
    color: "#711c2a",
    roughness: 0.72,
    emissive: "#25050c",
  });
  const bricks = [
    new MeshStandardMaterial({ color: "#df3b49", roughness: 0.65 }),
    new MeshStandardMaterial({ color: "#ff6872", roughness: 0.65 }),
  ];
  const brickGeometry = new BoxGeometry(0.62, 0.25, 0.32);
  const basePositions = [-5.7, -1.9, 1.9, 5.7];

  for (const x of basePositions) {
    const base = new Group();
    base.position.set(x, -3.25, 0);
    scene.add(base);

    const outer = new Mesh(new BoxGeometry(2.18, 1.02, 0.3), mortar);
    base.add(outer);

    const layout = [
      { count: 3, y: 0.26, offset: 0 },
      { count: 4, y: -0.01, offset: 0.5 },
      { count: 3, y: -0.28, offset: 0 },
    ];
    for (const [rowIndex, row] of layout.entries()) {
      for (let column = 0; column < row.count; column += 1) {
        const brick = new Mesh(brickGeometry, bricks[(column + rowIndex) % bricks.length]);
        brick.position.set(
          (column - (row.count - 1) / 2) * 0.66 + (row.offset ? 0.08 : 0),
          row.y,
          0.18,
        );
        base.add(brick);
      }
    }
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
  private readonly clouds: Group[];
  private readonly shadow: Mesh;
  private readonly playerRoot = new Group();
  private readonly enemyViews = new Map<number, Group>();
  private readonly playerShotViews = new Map<number, Mesh>();
  private readonly enemyShotViews = new Map<number, Mesh>();
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
    container.append(this.renderer.domElement);
    this.camera.position.z = 20;
    this.camera.lookAt(0, 0, 0);

    this.background = new Mesh(new PlaneGeometry(1, 1), makeGradientMaterial());
    this.background.position.z = -10;
    this.scene.add(this.background);
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

    this.clouds = [
      makeCloud(-5.4, 3.3, 1.25),
      makeCloud(4.8, 5.2, 0.95),
      makeCloud(0.5, 1.25, 0.75),
    ];
    this.scene.add(...this.clouds);
    addFirewallBases(this.scene);

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

  update(state: GameState, deltaSeconds: number, elapsedSeconds: number): void {
    const delta = Math.min(deltaSeconds, 0.05);
    for (let index = 0; index < this.clouds.length; index += 1) {
      const cloud = this.clouds[index]!;
      cloud.position.x += (index % 2 === 0 ? 0.13 : -0.1) * delta;
      if (cloud.position.x > 9) cloud.position.x = -9;
      if (cloud.position.x < -9) cloud.position.x = 9;
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
    this.renderer.dispose();
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
    this.renderer.setSize(window.innerWidth, window.innerHeight);
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
}
