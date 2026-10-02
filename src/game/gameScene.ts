import { AdditiveBlending, AmbientLight, Box3, BoxGeometry, BufferGeometry, CanvasTexture, DirectionalLight, Group, IcosahedronGeometry, InstancedMesh, Material, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, NormalBlending, Object3D, OctahedronGeometry, PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry, PointLight, Points, Scene, ShaderMaterial, SphereGeometry, Sprite, SpriteMaterial, TorusGeometry, Vector2, Vector3, Vector4, WebGLRenderer } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { BombCancel, GameEvent, GameState, GroundImpact, MysteryHit, Projectile, ShieldHit } from "./gameLogic";
import { ALIEN_VARIANT_COUNT, FORMATION_INTRO_SECONDS, GROUND_Y, MYSTERY_EDGE, MYSTERY_Y, PLAYER_MUZZLE_OFFSET, PLAYER_Y, SHIELD_HEIGHT, SHIELD_WIDTH, SHIELD_Y, WORLD_WIDTH, WORM_AMPLITUDE, WORM_FREQUENCY } from "./gameLogic";
import { ALIEN_MODEL_PATHS, BACKGROUND_DISTANCE, BOMB_DEPTH, CAMERA_DISTANCE, CAMERA_HEIGHT, DAMAGE_HOLE_CAPACITY, HALF_WIDTH, MIN_VIEW_HEIGHT, PARALLAX_EASE, PARALLAX_OVERSCAN, PARALLAX_X, PARALLAX_Y, PLAYER_GROUND_Y, PLAYER_SHADOW_Y, SHIELD_CHUNK_COLORS } from "./scene/constants";
import { createCloudHazeTexture, createDustTexture, createMuzzleFlareTexture, createScorePopupTexture, seededRandom } from "./scene/textures";
import { STAR_COUNT, STAR_LOWEST_SCREEN_Y, STAR_MARGIN_HEIGHT, STAR_PLANE_Z, drawBackground, makeCloud, makeGradientMaterial, makeStarField } from "./scene/background";
import { makeErodibleMaterial, makeHoleWalls, setDamageUniforms } from "./scene/shieldMaterial";
import { ALIEN_DEPTH_MULTIPLIER, ROW_SHADOW_LIFT, SHIP_SHADOW_DEPTH, SHIP_SHADOW_WIDTH, drawShieldShadow, makeAlienShadow, makeShieldShadow, makeShipShadow, updateAlienShadow } from "./scene/shadows";
import type { ShieldShadow } from "./scene/shadows";
import { MYSTERY_BEACON_COUNT, makeMysteryShip } from "./scene/mysteryShip";
import { formationFlightPose, makeEnemy } from "./scene/formation";
import { BINARY_FLICKER_SECONDS, BINARY_GLYPH_HEIGHT, BINARY_GLYPH_SPACING, BOMB_CANCEL_COLORS, HEX_GLYPH_HEIGHT, HEX_GLYPH_WIDTH, MALWARE_CUBE_SIZE, WORM_SEGMENT_LAG, WORM_SEGMENT_SPACING, createBinaryGlyphTextures, createHexGlyphTextures, createMalwareFaceTextures, makeBinaryStream, makeMalwareBomb, makeRansomwareBomb, makeWormBomb } from "./scene/bombs";

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

interface ScorePopup {
  sprite: Sprite;
  age: number;
  startY: number;
}

const SCORE_POPUP_LIFETIME = 1.3;

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
  private readonly enemyViews = new Map<number, Group>();
  private readonly enemyShadows = new Map<number, Mesh>();
  private readonly alienDeaths: AlienDeathAnimation[] = [];
  private readonly mysteryView = makeMysteryShip();
  private mysteryId = -1;
  private mysteryAge = 0;
  private readonly scorePopups: ScorePopup[] = [];
  // 1 right after a march step, decaying to 0; drives the formation's step hop.
  private marchPulse = 0;
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
  private readonly wormSegmentGeometry = new SphereGeometry(1, 14, 10);
  private readonly ransomwareCoreGeometry = new OctahedronGeometry(1, 0);
  private readonly ransomwareRingGeometry = new TorusGeometry(0.3, 0.03, 8, 32);
  private readonly hitParticles: HitParticle[] = [];
  private readonly fragmentGeometry = new IcosahedronGeometry(1, 0);
  private readonly floorDecalGeometry = new PlaneGeometry(1, 1);
  private readonly dustTexture: CanvasTexture;
  private readonly loader = new GLTFLoader();
  private shipLoaded = false;
  private previousShipX = 0;
  private hitVibration = 0;
  private playerDeathSeed = 0;
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
    this.scene.add(this.mysteryView.root);
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

  /** Reacts to what the simulation reported since the last frame; call before update(). */
  handleEvents(events: readonly GameEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case "playerFired":
          this.recoil = 0.22;
          this.muzzleFlash = 1;
          break;
        case "playerHit":
          this.hitVibration = 0.55;
          break;
        case "gameOver":
          this.playerDeathSeed = event.seed;
          break;
        case "marchBeat":
          this.marchPulse = 1;
          break;
        case "alienDestroyed":
          this.destroyEnemyView(event.id);
          break;
        case "shieldHit":
          this.shieldHitShake.set(event.shieldId, 0.32);
          this.spawnShieldHitParticles(event);
          break;
        case "groundImpact":
          this.spawnGroundSplat(event);
          break;
        case "mysteryDestroyed":
          this.spawnMysteryDestruction(event);
          break;
        case "bombCancelled":
          this.spawnBombCancel(event);
          break;
        default:
          break;
      }
    }
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
        smokeSeed: this.playerDeathSeed >>> 0,
      };
    }
    this.starMaterial.uniforms.uTime!.value = elapsedSeconds;
    this.accentLight.position.set(
      Math.sin(elapsedSeconds * 0.28) * 7,
      1.5 + Math.sin(elapsedSeconds * 0.43) * 2.2,
      6 + Math.cos(elapsedSeconds * 0.31) * 1.5,
    );
    this.accentLight.intensity = 9.5 + Math.sin(elapsedSeconds * 0.7) * 1.5;
    this.updateMysteryShip(state, delta, elapsedSeconds);
    this.updateScorePopups(delta);
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

    const turn = Math.max(-1, Math.min(1, shipVelocity / 8));
    const turnBlend = 1 - Math.exp(-12 * delta);
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
      // Aliens cleared without a hit (an invasion resets the formation) still burst away.
      for (const id of [...this.enemyViews.keys()]) {
        if (!currentEnemyIds.has(id)) this.destroyEnemyView(id);
      }
      const introProgress = state.formationIntro > 0
        ? 1 - state.formationIntro / FORMATION_INTRO_SECONDS
        : 1;
      this.marchPulse = Math.max(0, this.marchPulse - delta * 6);
      const stepEase = this.marchPulse * this.marchPulse;
      const stepHop = Math.sin(this.marchPulse * Math.PI) * 0.07;
      const stepTilt = (state.marchBeat % 2 === 0 ? 1 : -1) * stepEase * 0.07;
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
          y + Math.sin(elapsedSeconds * 2 + phase) * 0.045 + stepHop,
          (flight?.z ?? 0) + Math.cos(elapsedSeconds * 1.4 + phase) * 0.055,
        );
        view.rotation.x = Math.sin(elapsedSeconds * 1.4 + phase) * 0.045 + (flight?.pitch ?? 0);
        view.rotation.y = Math.cos(elapsedSeconds * 1.1 + phase) * 0.075 + (flight?.yaw ?? 0);
        view.rotation.z =
          Math.sin(elapsedSeconds * 1.7 + phase) * 0.035 + (flight?.bank ?? 0) + stepTilt;
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
    this.mysteryView.root.visible = false;
    this.mysteryId = -1;
    this.clearScorePopups();
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
    for (const geometry of this.mysteryView.geometries) geometry.dispose();
    for (const material of this.mysteryView.materials) material.dispose();
    this.fragmentGeometry.dispose();
    this.floorDecalGeometry.dispose();
    this.binaryGlyphGeometry.dispose();
    for (const texture of this.binaryGlyphTextures) texture.dispose();
    this.malwareCubeGeometry.dispose();
    this.malwareFaceTextures.map.dispose();
    this.malwareFaceTextures.emissiveMap.dispose();
    this.hexGlyphGeometry.dispose();
    for (const texture of this.hexGlyphTextures) texture.dispose();
    this.wormSegmentGeometry.dispose();
    this.ransomwareCoreGeometry.dispose();
    this.ransomwareRingGeometry.dispose();
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

  private destroyEnemyView(id: number): void {
    const view = this.enemyViews.get(id);
    if (!view) return;
    this.alienDeaths.push({ view, age: 0 });
    // The binary stream strikes the alien's underside; light it from just below and in front.
    const impact = new Vector3(view.position.x, view.position.y - 0.3, 0.55);
    this.flashImpactLight(impact, "#5fb4d8", ALIEN_HIT_LIGHT_INTENSITY, 0.26, 3.6);
    this.spawnAlienHitFlare(new Vector3(impact.x, impact.y, 0.4));
    this.enemyViews.delete(id);
    this.removeEnemyShadow(id);
  }

  private clearHitParticles(): void {
    for (const particle of this.hitParticles) {
      this.scene.remove(particle.object);
      particle.object.material.dispose();
    }
    this.hitParticles.length = 0;
  }

  private updateMysteryShip(state: GameState, delta: number, elapsedSeconds: number): void {
    const ship = state.mystery;
    const view = this.mysteryView;
    if (!ship) {
      view.root.visible = false;
      this.mysteryId = -1;
      return;
    }
    if (ship.id !== this.mysteryId) {
      this.mysteryId = ship.id;
      this.mysteryAge = 0;
    }
    this.mysteryAge += delta;
    // Warp in on arrival and shrink away as it reaches the far edge.
    const arrive = Math.min(1, this.mysteryAge / 0.45);
    const edge = Math.max(0, Math.min(1, (MYSTERY_EDGE - Math.abs(ship.x)) / 0.9));
    const reach = ship.x * ship.direction > 0 ? edge : 1;
    const presence = Math.min(arrive, reach);
    const eased = presence * presence * (3 - 2 * presence);
    view.root.visible = eased > 0.01;
    view.root.scale.set(eased, eased, eased);
    view.root.position.set(ship.x, MYSTERY_Y + Math.sin(elapsedSeconds * 2.6) * 0.08, 0.2);
    view.root.rotation.set(0.42, 0, -ship.direction * 0.12 + Math.sin(elapsedSeconds * 1.9) * 0.04);
    view.spinner.rotation.y += delta * 2.4 * ship.direction;
    const chase = elapsedSeconds * 9;
    view.beacons.forEach((material, index) => {
      const phase = (chase - index + MYSTERY_BEACON_COUNT * 100) % MYSTERY_BEACON_COUNT;
      material.emissiveIntensity = phase < 1 ? 1.6 : 0.2;
    });
  }

  private spawnMysteryDestruction(hit: MysteryHit): void {
    const center = new Vector3(hit.x, hit.y, 0.3);
    this.mysteryView.root.visible = false;
    this.mysteryId = -1;
    this.spawnAlienHitFlare(center);
    this.spawnAlienBurst(center, hit.seed);
    this.spawnAlienBurst(center, hit.seed ^ 0x3c6ef372);
    this.flashImpactLight(new Vector3(hit.x, hit.y, 1), "#d9a35f", ALIEN_BURST_LIGHT_INTENSITY * 1.3, 0.55, 7);

    const material = new SpriteMaterial({
      map: createScorePopupTexture(`+${hit.points}`),
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    const sprite = new Sprite(material);
    sprite.scale.set(1.6, 0.6, 1);
    sprite.position.copy(center);
    sprite.renderOrder = 4;
    this.scene.add(sprite);
    this.scorePopups.push({ sprite, age: 0, startY: hit.y });
  }

  private updateScorePopups(delta: number): void {
    for (let index = this.scorePopups.length - 1; index >= 0; index -= 1) {
      const popup = this.scorePopups[index]!;
      popup.age += delta;
      const progress = popup.age / SCORE_POPUP_LIFETIME;
      if (progress >= 1) {
        this.removeScorePopup(popup);
        this.scorePopups.splice(index, 1);
        continue;
      }
      const rise = 1 - (1 - progress) * (1 - progress);
      popup.sprite.position.y = popup.startY + rise * 0.7;
      popup.sprite.material.opacity = progress < 0.55 ? 1 : 1 - (progress - 0.55) / 0.45;
    }
  }

  private removeScorePopup(popup: ScorePopup): void {
    this.scene.remove(popup.sprite);
    popup.sprite.material.map?.dispose();
    popup.sprite.material.dispose();
  }

  private clearScorePopups(): void {
    for (const popup of this.scorePopups) this.removeScorePopup(popup);
    this.scorePopups.length = 0;
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
    // Move the eye away from the mouse while still looking at the play field centre,
    // so the scene tilts toward the cursor and near objects slide against the far sky.
    this.camera.position.set(-x * PARALLAX_X, CAMERA_HEIGHT - y * PARALLAX_Y, CAMERA_DISTANCE);
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
      const kind = projectile.kind ?? "malware";
      let view = this.enemyShotViews.get(projectile.id);
      if (!view) {
        view =
          kind === "worm"
            ? makeWormBomb(this.wormSegmentGeometry)
            : kind === "ransomware"
              ? makeRansomwareBomb(this.ransomwareCoreGeometry, this.ransomwareRingGeometry)
              : makeMalwareBomb(
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
      if (kind === "worm") {
        this.updateWormBomb(view, projectile);
        continue;
      }
      if (kind === "ransomware") {
        this.updateRansomwareBomb(view, projectile, elapsedSeconds);
        continue;
      }
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

  private updateWormBomb(view: Group, projectile: Projectile): void {
    const age = projectile.age ?? 0;
    const originX = projectile.originX ?? projectile.x;
    view.children.forEach((segment, index) => {
      // Each segment retraces where the head was a moment ago, so the body snakes behind it.
      const lagged = Math.max(0, age - index * WORM_SEGMENT_LAG);
      segment.position.x = originX + Math.sin(lagged * WORM_FREQUENCY) * WORM_AMPLITUDE - projectile.x;
      segment.position.y = index * WORM_SEGMENT_SPACING;
      segment.position.z = Math.sin(age * 9 - index * 0.8) * 0.04;
    });
  }

  private updateRansomwareBomb(view: Group, projectile: Projectile, elapsedSeconds: number): void {
    const [core, ...rings] = view.children as Mesh[];
    if (!core) return;
    const cracked = (projectile.hp ?? 2) < 2;
    core.rotation.y = elapsedSeconds * 2.4 + projectile.id;
    const coreMaterial = core.material as MeshStandardMaterial;
    coreMaterial.emissiveIntensity = 0.55 + Math.sin(elapsedSeconds * 6 + projectile.id) * 0.15;
    rings.forEach((ring, index) => {
      ring.rotation.x = elapsedSeconds * (index === 0 ? 1.6 : -1.9);
      const material = ring.material as MeshStandardMaterial;
      if (cracked) {
        // A cracked lock loses a ring's worth of glow and flickers like it is failing.
        material.color.set("#9c5a50");
        material.emissive.set("#6a2a24");
        material.emissiveIntensity = 0.4 + (Math.sin(elapsedSeconds * 23 + index) > 0.3 ? 0.4 : 0);
        ring.scale.setScalar(index === 0 ? 1 : 0.82);
      }
    });
  }

  private spawnBombCancel(cancel: BombCancel): void {
    const random = seededRandom(cancel.seed);
    const palette = BOMB_CANCEL_COLORS[cancel.kind];
    const center = new Vector3(cancel.x, cancel.y, BOMB_DEPTH + 0.1);
    const sparkCount = cancel.destroyed ? 10 + Math.floor(random() * 5) : 5;
    for (let index = 0; index < sparkCount; index += 1) {
      const color = palette.spark[Math.floor(random() * palette.spark.length)]!;
      const spark = new Mesh(
        this.fragmentGeometry,
        new MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.6,
          roughness: 0.4,
          transparent: true,
          depthWrite: false,
        }),
      );
      const size = 0.03 + random() * 0.04;
      spark.scale.setScalar(size);
      spark.position.copy(center);
      this.scene.add(spark);
      const angle = random() * Math.PI * 2;
      const speed = (cancel.destroyed ? 1.6 : 1.1) + random() * 2;
      this.hitParticles.push({
        object: spark,
        velocity: new Vector3(Math.cos(angle) * speed, Math.sin(angle) * speed, (random() - 0.5) * 1.4),
        angularVelocity: new Vector3((random() - 0.5) * 20, (random() - 0.5) * 20, (random() - 0.5) * 20),
        age: 0,
        lifetime: 0.3 + random() * 0.3,
        gravity: 1.4,
        initialScale: size,
        kind: "spark",
      });
    }
    if (cancel.destroyed) this.spawnAlienHitFlare(center);
    this.flashImpactLight(
      new Vector3(cancel.x, cancel.y, 0.8),
      palette.light,
      ALIEN_HIT_LIGHT_INTENSITY * (cancel.destroyed ? 0.9 : 0.5),
      cancel.destroyed ? 0.28 : 0.18,
      3.2,
    );
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
