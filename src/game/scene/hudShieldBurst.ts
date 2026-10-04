import { AmbientLight, Box3, BufferAttribute, BufferGeometry, DirectionalLight, Mesh, MeshStandardMaterial, OrthographicCamera, Scene, Sprite, SpriteMaterial, Vector3 } from "three";
import { ConvexGeometry } from "three/addons/geometries/ConvexGeometry.js";
import type { Texture, WebGLRenderer } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { seededRandom } from "./textures";

const SHARD_COUNT = 9;
const SHARD_LIFETIME = 1.3;
const SMOKE_COUNT = 9;
const SMOKE_COLORS = ["#77808a", "#8a939c", "#9fa7ae", "#646d77"] as const;
// Screen-space gravity in CSS pixels per second squared (y grows downward on screen).
const GRAVITY = 200;

interface Shard {
  geometry: BufferGeometry;
  // Shard centre relative to the model centre, in model units.
  offset: Vector3;
}

interface BurstParticle {
  object: Mesh<BufferGeometry, MeshStandardMaterial> | Sprite;
  velocity: Vector3;
  spin: Vector3;
  age: number;
  lifetime: number;
  baseScale: number;
  smoke: boolean;
}

// Shatters the HUD shield icon into pieces of the real shield GLB with a puff of smoke.
// Drawn as an overlay pass in CSS-pixel space so it lines up with the DOM icon it replaces.
export class HudShieldBurst {
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(0, 1, 0, -1, -2000, 2000);
  private readonly particles: BurstParticle[] = [];
  private shards: Shard[] = [];
  private modelHeight = 1;
  private seed = 0x5eed;
  private lastTime = performance.now();

  constructor(url: string, private readonly smokeTexture: Texture) {
    this.scene.add(new AmbientLight("#b9e4ff", 1.5));
    const light = new DirectionalLight("#ffffff", 3);
    light.position.set(-200, 300, 500);
    this.scene.add(light);
    new GLTFLoader().load(url, (gltf) => {
      let source: Mesh | undefined;
      gltf.scene.traverse((object) => {
        if (!source && (object as Mesh).isMesh) source = object as Mesh;
      });
      if (!source) return;
      source.updateWorldMatrix(true, false);
      const geometry = (source.geometry.index ? source.geometry.toNonIndexed() : source.geometry.clone()).applyMatrix4(source.matrixWorld);
      geometry.computeBoundingBox();
      const box = geometry.boundingBox ?? new Box3();
      this.modelHeight = Math.max(1e-3, box.max.y - box.min.y);
      geometry.translate(...box.getCenter(new Vector3()).negate().toArray());
      this.shards = splitIntoShards(geometry, SHARD_COUNT);
      geometry.dispose();
    });
  }

  get active(): boolean {
    return this.particles.length > 0;
  }

  // `rect` is the icon's DOM rect; `canvas` locates the overlay relative to the page.
  burst(rect: DOMRect, canvas: DOMRect): void {
    const centerX = rect.left - canvas.left + rect.width / 2;
    const centerY = rect.top - canvas.top + rect.height / 2;
    const scale = rect.height / this.modelHeight;
    this.seed = (this.seed * 1103515245 + 12345) >>> 0;
    const random = seededRandom(this.seed);

    for (const shard of this.shards) {
      const material = new MeshStandardMaterial({
        color: "#36a9eb", roughness: 0.45, metalness: 0.25, transparent: true,
      });
      const mesh = new Mesh(shard.geometry, material);
      mesh.scale.setScalar(scale);
      mesh.position.set(centerX + shard.offset.x * scale, -(centerY - shard.offset.y * scale), shard.offset.z * scale);
      const direction = new Vector3(shard.offset.x, shard.offset.y, 0);
      if (direction.lengthSq() < 1e-6) direction.set(random() - 0.5, 1, 0);
      direction.normalize();
      const speed = rect.height * (1.2 + random() * 1.4);
      this.scene.add(mesh);
      this.particles.push({
        object: mesh,
        velocity: new Vector3(direction.x * speed, direction.y * speed + 45 + random() * 30, (random() - 0.5) * rect.height * 3),
        spin: new Vector3((random() - 0.5) * 14, (random() - 0.5) * 14, (random() - 0.5) * 10),
        age: 0,
        lifetime: SHARD_LIFETIME * (0.8 + random() * 0.4),
        baseScale: scale,
        smoke: false,
      });
    }

    for (let index = 0; index < SMOKE_COUNT; index += 1) {
      const material = new SpriteMaterial({
        map: this.smokeTexture,
        color: SMOKE_COLORS[Math.floor(random() * SMOKE_COLORS.length)]!,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        rotation: random() * Math.PI * 2,
      });
      const sprite = new Sprite(material);
      const size = rect.height * (1 + random() * 0.6);
      const angle = random() * Math.PI * 2;
      const drift = 8 + random() * 16;
      sprite.scale.set(size, size, 1);
      sprite.position.set(centerX + Math.cos(angle) * 3, -centerY + Math.sin(angle) * 3, -50);
      this.scene.add(sprite);
      this.particles.push({
        object: sprite,
        velocity: new Vector3(Math.cos(angle) * drift, Math.sin(angle) * drift + 10, 0),
        spin: new Vector3(0, 0, (random() - 0.5) * 1.2),
        age: 0,
        lifetime: 1.1 + random() * 0.6,
        baseScale: size,
        smoke: true,
      });
    }
  }

  render(renderer: WebGLRenderer, width: number, height: number): void {
    const now = performance.now();
    const delta = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    if (!this.active) return;

    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index]!;
      particle.age += delta;
      const life = particle.age / particle.lifetime;
      if (life >= 1) {
        this.removeParticle(index);
        continue;
      }
      const { object } = particle;
      if (particle.smoke) {
        particle.velocity.multiplyScalar(Math.exp(-1.6 * delta));
        object.position.addScaledVector(particle.velocity, delta);
        const sprite = object as Sprite;
        sprite.material.rotation += particle.spin.z * delta;
        const grow = particle.baseScale * (1 + 1.4 * (1 - (1 - life) ** 2));
        sprite.scale.set(grow, grow, 1);
        // Quick soft bloom in, long fade out; kept subtle to match the muted palette.
        sprite.material.opacity = 0.55 * Math.min(1, life / 0.12) * (1 - life) ** 1.4;
      } else {
        particle.velocity.y -= GRAVITY * delta;
        object.position.addScaledVector(particle.velocity, delta);
        object.rotation.x += particle.spin.x * delta;
        object.rotation.y += particle.spin.y * delta;
        object.rotation.z += particle.spin.z * delta;
        const mesh = object as Mesh<BufferGeometry, MeshStandardMaterial>;
        mesh.material.opacity = life < 0.6 ? 1 : 1 - (life - 0.6) / 0.4;
        mesh.scale.setScalar(particle.baseScale * (1 - 0.35 * life));
      }
    }

    this.camera.left = 0;
    this.camera.right = width;
    this.camera.top = 0;
    this.camera.bottom = -height;
    this.camera.updateProjectionMatrix();
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = autoClear;
  }

  clear(): void {
    for (let index = this.particles.length - 1; index >= 0; index -= 1) this.removeParticle(index);
  }

  dispose(): void {
    this.clear();
    for (const shard of this.shards) shard.geometry.dispose();
  }

  private removeParticle(index: number): void {
    const [particle] = this.particles.splice(index, 1);
    if (!particle) return;
    this.scene.remove(particle.object);
    particle.object.material.dispose();
  }
}

// Groups triangles around random seed points (a coarse Voronoi split) so each shard is an irregular chunk.
export function splitIntoShards(geometry: BufferGeometry, count: number): Shard[] {
  const position = geometry.getAttribute("position");
  const box = geometry.boundingBox ?? new Box3().setFromBufferAttribute(position as BufferAttribute);
  const random = seededRandom(0x51e1d);
  const seeds = Array.from({ length: count }, () => new Vector3(
    box.min.x + (box.max.x - box.min.x) * (0.1 + random() * 0.8),
    box.min.y + (box.max.y - box.min.y) * (0.1 + random() * 0.8),
    0,
  ));
  const groups: number[][] = seeds.map(() => []);
  const centroid = new Vector3();
  const triangleCount = position.count / 3;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    centroid.set(0, 0, 0);
    for (let corner = 0; corner < 3; corner += 1) {
      const vertex = triangle * 3 + corner;
      centroid.x += position.getX(vertex) / 3;
      centroid.y += position.getY(vertex) / 3;
    }
    let nearest = 0;
    let nearestDistance = Infinity;
    seeds.forEach((seed, index) => {
      const distance = (seed.x - centroid.x) ** 2 + (seed.y - centroid.y) ** 2;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = index;
      }
    });
    groups[nearest]!.push(triangle);
  }

  const attributeNames = Object.keys(geometry.attributes);
  return groups.filter((group) => group.length > 0).map((group) => {
    const shard = new BufferGeometry();
    for (const name of attributeNames) {
      const source = geometry.getAttribute(name);
      const data = new Float32Array(group.length * 3 * source.itemSize);
      group.forEach((triangle, slot) => {
        for (let corner = 0; corner < 3; corner += 1) {
          for (let component = 0; component < source.itemSize; component += 1) {
            data[(slot * 3 + corner) * source.itemSize + component] = source.getComponent(triangle * 3 + corner, component);
          }
        }
      });
      shard.setAttribute(name, new BufferAttribute(data, source.itemSize));
    }
    shard.computeBoundingBox();
    const offset = shard.boundingBox!.getCenter(new Vector3());
    shard.translate(-offset.x, -offset.y, -offset.z);
    // Close fracture surfaces so tumbling fragments never reveal hollow triangle shells.
    const vertices = shard.getAttribute("position");
    const points = Array.from({ length: vertices.count }, (_, index) =>
      new Vector3().fromBufferAttribute(vertices, index));
    const solid = new ConvexGeometry(points);
    shard.dispose();
    return { geometry: solid, offset };
  });
}
