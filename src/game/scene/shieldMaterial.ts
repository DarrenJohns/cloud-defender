import { CylinderGeometry, DoubleSide, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshStandardMaterial, Vector2, Vector4 } from "three";
import type { DamageHole } from "../gameLogic";
import { DAMAGE_HOLE_CAPACITY, HOLE_CUT_FACTOR } from "./constants";

export function makeErodibleMaterial(
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
export const HOLE_EDGE_GLSL = "holeEdge";
export const HOLE_EDGE_FUNCTION = `
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
export function makeHoleWalls(
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

export function setDamageUniforms(
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
