import { AdditiveBlending, AmbientLight, Box3, DirectionalLight, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, OrthographicCamera, Scene, Sprite, SpriteMaterial, TorusGeometry, Vector3, WebGLRenderer } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createMuzzleFlareTexture } from "./textures";

const HOLD_SECONDS = 2.4;
const FLIGHT_SECONDS = 1;

/** Independent screen-space pass so the shield can fly precisely into a DOM HUD slot. */
export class ShieldAward {
  readonly element = document.createElement("div");
  private readonly renderer = new WebGLRenderer({ alpha: true, antialias: true });
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(0, 1, 0, -1, -2000, 2000);
  private readonly root = new Group();
  private readonly shine = new DirectionalLight("#e5f3ff", 4);
  private readonly flareTexture = createMuzzleFlareTexture();
  private readonly aura = new Sprite(new SpriteMaterial({
    map: this.flareTexture, color: "#789fb5", blending: AdditiveBlending, transparent: true, depthWrite: false,
  }));
  private readonly rings = Array.from({ length: 3 }, () => new Mesh(
    new TorusGeometry(1, 0.008, 6, 96),
    new MeshBasicMaterial({ color: "#a0c6d8", transparent: true, blending: AdditiveBlending, depthWrite: false }),
  ));
  private readonly sparks = Array.from({ length: 32 }, () => new Sprite(new SpriteMaterial({
    map: this.flareTexture, color: "#c3dfeb", blending: AdditiveBlending, transparent: true, depthWrite: false,
  })));
  private modelHeight = 1;
  private age = 0;
  private target: HTMLElement | undefined;
  private width = 0;
  private height = 0;

  constructor(onReady: () => void, onError: (message: string) => void) {
    this.element.id = "shield-award";
    this.element.hidden = true;
    this.element.setAttribute("role", "status");
    this.element.setAttribute("aria-label", "New shield acquired");
    this.element.append(this.renderer.domElement);
    document.body.append(this.element);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.add(this.root, new AmbientLight("#b5c7d7", 2), this.shine);
    this.shine.position.set(-200, 200, 500);
    this.scene.add(this.shine.target);
    this.scene.add(this.aura, ...this.rings, ...this.sparks);
    new GLTFLoader().load(`${import.meta.env.BASE_URL}assets/shield-hud.glb`, (gltf) => {
      const box = new Box3().setFromObject(gltf.scene);
      this.modelHeight = Math.max(0.001, box.max.y - box.min.y);
      gltf.scene.position.sub(box.getCenter(new Vector3()));
      gltf.scene.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        const originals = Array.isArray(object.material) ? object.material : [object.material];
        const materials = originals.map((original) => {
          const textured = original instanceof MeshStandardMaterial || original instanceof MeshBasicMaterial;
          const material = new MeshStandardMaterial({
            map: textured ? original.map : null,
            color: textured ? original.color : "#96c5e0",
            metalness: 0.45, roughness: 0.2,
            emissive: "#29445b", emissiveIntensity: 0.35,
            side: original.side,
          });
          original.dispose();
          return material;
        });
        object.material = Array.isArray(object.material) ? materials : materials[0]!;
      });
      this.root.add(gltf.scene);
      onReady();
    }, undefined, () => onError("Could not load the shield award model."));
  }

  get active(): boolean {
    return this.target !== undefined;
  }

  start(target: HTMLElement): void {
    this.target = target;
    this.age = 0;
    this.element.hidden = false;
    this.element.dataset.phase = "showcase";
  }

  /** Returns true once the shield has landed. Layout is sampled every frame for resize support. */
  update(delta: number): boolean {
    if (!this.target) return false;
    this.age += delta;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const rect = this.target.getBoundingClientRect();
    const flight = Math.min(1, Math.max(0, (this.age - HOLD_SECONDS) / FLIGHT_SECONDS));
    const ease = flight * flight * (3 - 2 * flight);
    const size = Math.min(320, width * 0.46, height * 0.44);
    const reveal = Math.min(1, this.age / 0.7);
    const pop = 1 + 2.7 * (reveal - 1) ** 3 + 1.7 * (reveal - 1) ** 2;
    const flightPosition = (progress: number): { x: number; y: number } => {
      const eased = progress * progress * (3 - 2 * progress);
      return {
        x: width / 2 + (rect.left + rect.width / 2 - width / 2) * eased + Math.sin(progress * Math.PI) * width * 0.13,
        y: height * 0.44 + (rect.top + rect.height / 2 - height * 0.44) * eased,
      };
    };
    const { x, y } = flightPosition(flight);
    this.root.position.set(x, -y, 0);
    this.root.scale.setScalar((size * pop + (rect.height - size * pop) * ease) / this.modelHeight);
    this.root.rotation.set(0.12 * (1 - ease), (Math.PI * 2 * (1 - reveal) ** 2 + Math.sin(this.age * 2) * 0.3) * (1 - ease), -0.12 * Math.sin(this.age * 2) * (1 - ease));
    this.shine.position.set(x + Math.sin(this.age * 4) * 450, -y + 220, 350);
    this.shine.target.position.copy(this.root.position);
    this.aura.position.set(x, -y, -100);
    this.aura.scale.setScalar(size * (2.2 + Math.sin(this.age * 3) * 0.15) * (1 - ease));
    this.aura.material.opacity = Math.min(1, this.age * 4) * 0.55 * (1 - ease);
    this.rings.forEach((ring, index) => {
      const progress = Math.max(0, (this.age - index * 0.18) / 1.7);
      ring.position.set(width / 2, -height * 0.44, -50);
      ring.scale.setScalar(size * (0.35 + Math.min(1.6, progress) * 0.8));
      ring.material.opacity = Math.max(0, 1 - progress) * 0.6 * (1 - ease);
      ring.rotation.set(index === 1 ? 0.55 : 0, index === 2 ? 0.45 : 0, this.age * 0.3);
    });
    this.sparks.forEach((spark, index) => {
      if (flight > 0) {
        const lag = index / this.sparks.length * 0.22;
        const tail = flightPosition(Math.max(0, flight - lag));
        spark.position.set(tail.x, -tail.y, -20);
        spark.scale.setScalar((1 - index / this.sparks.length) * 26);
        spark.material.opacity = (1 - index / this.sparks.length) * Math.sin(flight * Math.PI) * 0.6;
        return;
      }
      const angle = index * 2.39996 + this.age * 0.18;
      const distance = size * (0.5 + (index % 7) * 0.065 + Math.min(1, this.age) * 0.3);
      spark.position.set(x + Math.cos(angle) * distance * (1 - ease), -y + Math.sin(angle) * distance * (1 - ease), 50);
      const sparkle = Math.max(0, Math.sin(this.age * 5 + index * 1.7));
      spark.scale.set(5 + sparkle * 18, 3 + sparkle * 5, 1);
      spark.material.rotation = angle;
      spark.material.opacity = sparkle * Math.min(1, this.age * 3) * (1 - ease);
    });
    this.element.dataset.phase = flight > 0 ? "flight" : "showcase";
    if (width !== this.width || height !== this.height) {
      this.renderer.setSize(width, height, false);
      this.width = width;
      this.height = height;
    }
    this.camera.right = width;
    this.camera.bottom = -height;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    if (flight < 1) return false;
    this.clear();
    return true;
  }

  clear(): void {
    this.target = undefined;
    this.element.hidden = true;
  }

  dispose(): void {
    this.root.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (material instanceof MeshStandardMaterial) material.map?.dispose();
        material.dispose();
      }
    });
    this.aura.material.dispose();
    this.flareTexture.dispose();
    for (const ring of this.rings) {
      ring.geometry.dispose();
      ring.material.dispose();
    }
    for (const spark of this.sparks) spark.material.dispose();
    this.renderer.dispose();
    this.element.remove();
  }
}
