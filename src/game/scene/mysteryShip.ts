import { BufferGeometry, CylinderGeometry, Group, Material, Mesh, MeshStandardMaterial, SphereGeometry, TorusGeometry } from "three";

export interface MysteryView {
  root: Group;
  spinner: Group;
  beacons: MeshStandardMaterial[];
  materials: Material[];
  geometries: BufferGeometry[];
}

export const MYSTERY_BEACON_COUNT = 8;

// A rogue "zero-day" saucer built from primitives: slate hull, amber rim beacons, smoked dome.
export function makeMysteryShip(): MysteryView {
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
  const track = <G extends BufferGeometry, M extends Material>(geometry: G, material: M): Mesh<G, M> => {
    geometries.push(geometry);
    materials.push(material);
    return new Mesh(geometry, material);
  };
  const root = new Group();
  const spinner = new Group();
  root.add(spinner);

  const hull = track(
    new SphereGeometry(1, 40, 16),
    new MeshStandardMaterial({ color: "#56606b", metalness: 0.65, roughness: 0.38 }),
  );
  hull.scale.set(0.86, 0.17, 0.86);
  spinner.add(hull);

  const rim = track(
    new TorusGeometry(0.84, 0.05, 10, 48),
    new MeshStandardMaterial({ color: "#7a6a52", emissive: "#a8743a", emissiveIntensity: 0.35, metalness: 0.5, roughness: 0.4 }),
  );
  rim.rotation.x = Math.PI / 2;
  spinner.add(rim);

  const dome = track(
    new SphereGeometry(0.34, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new MeshStandardMaterial({
      color: "#3c5866",
      emissive: "#2c6b7c",
      emissiveIntensity: 0.45,
      metalness: 0.2,
      roughness: 0.15,
      transparent: true,
      opacity: 0.88,
    }),
  );
  dome.position.y = 0.08;
  root.add(dome);

  const core = track(
    new CylinderGeometry(0.26, 0.34, 0.08, 24),
    new MeshStandardMaterial({ color: "#2e343b", emissive: "#b5793c", emissiveIntensity: 0.5, roughness: 0.6 }),
  );
  core.position.y = -0.15;
  root.add(core);

  const beaconGeometry = new SphereGeometry(0.055, 10, 8);
  geometries.push(beaconGeometry);
  const beacons: MeshStandardMaterial[] = [];
  for (let index = 0; index < MYSTERY_BEACON_COUNT; index += 1) {
    const material = new MeshStandardMaterial({ color: "#5a4a36", emissive: "#e0a050", emissiveIntensity: 0.2 });
    materials.push(material);
    beacons.push(material);
    const beacon = new Mesh(beaconGeometry, material);
    const angle = (index / MYSTERY_BEACON_COUNT) * Math.PI * 2;
    beacon.position.set(Math.cos(angle) * 0.7, 0.07, Math.sin(angle) * 0.7);
    spinner.add(beacon);
  }

  root.traverse((object) => {
    if (object instanceof Mesh) object.castShadow = true;
  });
  root.visible = false;
  return { root, spinner, beacons, materials, geometries };
}
