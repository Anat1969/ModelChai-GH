/**
 * The realistic level (LEVELS.md 2): the same mesh as the bare level, dressed in material, sun, season,
 * weather and context. Nothing here asks the Worker for geometry: every input is either the last build or a
 * field under `realistic` (CLAUDE.md, "הפרדת רמות").
 */
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  BackSide,
  BufferAttribute,
  BufferGeometry as Geometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Object3D,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
  type BufferGeometry,
  type Camera,
  type Group,
  type InstancedMesh,
} from 'three'
import type { BuildSuccess } from '../engine/build'
import { MATERIAL_LOOK } from '../engine/materials'
import type { MeshData } from '../engine/types'
import type { Built } from '../ui/params'
import { useStudio } from '../ui/store'
import { atmosphere, mixColor, tone } from './atmosphere'
import { Person, useGeometry } from './BareScene'
import { bounds, peopleSpots } from './cameras'
import {
  CONTEXTS,
  MARGIN,
  SEABED,
  VEGETATION,
  contextElements,
  groundHeight,
  riverWidth,
  rng,
  scatterPlants,
  seedOf,
  waterEdge,
  type Box,
  type ContextId,
  type Footprint,
  type Plant,
  type PlantKind,
  type VegetationId,
} from './contexts/layout'
import { GROUND_TILE, groundTexture, materialAlpha, materialTexture, type GroundKind, type MaterialId } from './materials/textures'
import { seasonOf } from './seasons'
import { localTime, sunAt } from './sun'
import { orientationOf, streamlines, windOfRecipe, type Wind } from './wind'

/** World-space box projection, in meters: the grain keeps its real size and needs no UVs from the engine. */
function withBoxUv(geo: BufferGeometry): BufferGeometry {
  if (geo.getAttribute('uv')) return geo
  const p = geo.getAttribute('position'), n = geo.getAttribute('normal')
  const uv = new Float32Array(p.count * 2)
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i))
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i)
    // Vertical faces map height to v, so courses, boards and strata stay horizontal.
    if (ay >= ax && ay >= az) (uv[i * 2] = x), (uv[i * 2 + 1] = z)
    else if (ax >= az) (uv[i * 2] = z), (uv[i * 2 + 1] = y)
    else (uv[i * 2] = x), (uv[i * 2 + 1] = y)
  }
  geo.setAttribute('uv', new BufferAttribute(uv, 2))
  return geo
}

function DressedPart({ mesh, material, wetness }: { mesh: MeshData | null; material: MaterialId; wetness: number }) {
  const geo = useGeometry(mesh)
  const uvGeo = useMemo(() => (geo ? withBoxUv(geo) : null), [geo])
  const look = MATERIAL_LOOK[material]
  const map = useMemo(() => materialTexture(material), [material])
  // Perforated sheet: the holes are cut by an alpha map, so light and shadow really pass through them.
  const alpha = useMemo(() => materialAlpha(material), [material])
  if (!uvGeo) return null
  const glass = material === 'glass_clear'
  return (
    <mesh geometry={uvGeo} castShadow={!glass} receiveShadow>
      <meshStandardMaterial
        // A new material per material id: maps that come and go need a new shader program.
        key={material}
        // A wet surface reads darker and glossier (DECISIONS.md 121); a visual cue, not a material model.
        color={tone(look.color, 1 - 0.18 * wetness)}
        roughness={look.roughness * (1 - 0.55 * wetness)}
        metalness={look.metalness}
        map={glass ? null : map}
        alphaMap={alpha}
        alphaTest={alpha ? 0.5 : 0}
        transparent={glass}
        opacity={glass ? 0.15 : 1}
        side={DoubleSide}
      />
    </mesh>
  )
}

const SKY_VERTEX = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
    gl_Position.z = gl_Position.w;
  }
`
const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 top;
  uniform vec3 horizon;
  uniform vec3 sunDir;
  uniform vec3 sunColor;
  uniform float sunGlow;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, 0.0, 1.0);
    vec3 c = mix(horizon, top, pow(h, 0.55));
    float s = max(dot(d, normalize(sunDir)), 0.0);
    c += sunColor * sunGlow * (pow(s, 600.0) * 2.0 + pow(s, 12.0) * 0.25);
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }
`

/** A dome that follows the camera: gradient from horizon to zenith, with the sun's disc and glow. */
function Sky({ top, horizon, sunDir, sunColor, sunGlow }: { top: string; horizon: string; sunDir: [number, number, number]; sunColor: string; sunGlow: number }) {
  const uniforms = useMemo(
    () => ({ top: { value: new Color() }, horizon: { value: new Color() }, sunDir: { value: [0, 1, 0] }, sunColor: { value: new Color() }, sunGlow: { value: 0 } }),
    [],
  )
  useLayoutEffect(() => {
    uniforms.top.value.set(top)
    uniforms.horizon.value.set(horizon)
    uniforms.sunDir.value = sunDir
    uniforms.sunColor.value.set(sunColor)
    uniforms.sunGlow.value = sunGlow
  }, [uniforms, top, horizon, sunDir, sunColor, sunGlow])
  return (
    <mesh frustumCulled={false} renderOrder={-1}>
      <sphereGeometry args={[2000, 32, 16]} />
      <shaderMaterial side={BackSide} depthWrite={false} uniforms={uniforms} vertexShader={SKY_VERTEX} fragmentShader={SKY_FRAGMENT} />
    </mesh>
  )
}

const GROUND_KIND: Record<ContextId, GroundKind> = {
  coastal_dunes: 'sand',
  urban_plaza: 'paving',
  desert_loess: 'earth',
  park_lawn: 'grass',
  waterfront: 'paving',
  urban_gateway: 'paving',
  forest_edge: 'grass',
  rocky_slope: 'rock',
  snow_field: 'snow',
  river_bank: 'grass',
}

const SNOW = '#eef1f4'

function Ground({ context, fp, color, size, kind, roughness }: { context: ContextId; fp: Footprint; color: string; size: number; kind: GroundKind; roughness: number }) {
  const def = CONTEXTS[context]
  const geo = useMemo(() => {
    const seg = def.relief || waterEdge(context, fp) !== null ? 160 : 1
    const g = new PlaneGeometry(size, size, seg, seg)
    g.rotateX(-Math.PI / 2)
    g.translate(fp.x, 0, fp.z)
    const h = groundHeight(def, fp)
    const p = g.getAttribute('position')
    for (let i = 0; i < p.count; i++) p.setY(i, h(p.getX(i), p.getZ(i)))
    // UVs in meters, like the model.
    const uv = g.getAttribute('uv')
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / GROUND_TILE, p.getZ(i) / GROUND_TILE)
    g.computeVertexNormals()
    return g
  }, [def, context, fp, size])
  useEffect(() => () => geo.dispose(), [geo])
  const map = useMemo(() => groundTexture(kind), [kind])
  return (
    <mesh geometry={geo} receiveShadow>
      <meshStandardMaterial color={color} roughness={roughness} map={map} />
    </mesh>
  )
}

function Water({ edge, fp, size, river }: { edge: number; fp: Footprint; size: number; river: number | null }) {
  const width = river ?? size / 2 + (edge - fp.x)
  if (width <= 0) return null
  return (
    <mesh rotation-x={-Math.PI / 2} position={[edge - width / 2, SEABED + 0.45, fp.z]} receiveShadow>
      <planeGeometry args={[width, size]} />
      <meshStandardMaterial color="#3f6f7f" roughness={0.12} metalness={0.25} />
    </mesh>
  )
}

/** One instanced mesh per plant part: hundreds of plants cost a few draw calls. */
type Placed = Plant & { y: number }

function Instanced({ items, color, kind, part }: { items: Placed[]; color: string; kind: PlantKind; part: 'trunk' | 'crown' }) {
  const ref = useRef<InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const o = new Object3D()
    items.forEach((p, i) => {
      o.position.set(p.x, p.y, p.z)
      o.rotation.set(0, p.rotation, 0)
      const s = SHAPES[kind][part](p.height)
      o.position.y += s.y
      o.scale.set(s.sx, s.sy, s.sz)
      o.updateMatrix()
      mesh.setMatrixAt(i, o.matrix)
    })
    mesh.count = items.length
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [items, kind, part])
  if (!items.length) return null
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, items.length]} castShadow receiveShadow key={items.length}>
      {part === 'trunk' ? (
        <cylinderGeometry args={[0.5, 0.7, 1, 7]} />
      ) : kind === 'conifer' ? (
        <coneGeometry args={[0.5, 1, 9]} />
      ) : (
        <icosahedronGeometry args={[0.5, 1]} />
      )}
      <meshStandardMaterial color={color} roughness={0.95} flatShading={part === 'crown'} />
    </instancedMesh>
  )
}

type Scale = { y: number; sx: number; sy: number; sz: number }
/** Proportions of each plant kind, from its height. Unit trunk is 1 m tall; unit crown is 1 m wide. */
const SHAPES: Record<PlantKind, { trunk: (h: number) => Scale; crown: (h: number) => Scale }> = {
  shrub: { trunk: () => ({ y: 0, sx: 0, sy: 0, sz: 0 }), crown: (h) => ({ y: h * 0.35, sx: h * 1.7, sy: h, sz: h * 1.5 }) },
  olive: {
    trunk: (h) => ({ y: h * 0.25, sx: 0.32, sy: h * 0.5, sz: 0.32 }),
    crown: (h) => ({ y: h * 0.62, sx: h * 1.05, sy: h * 0.7, sz: h * 0.95 }),
  },
  broadleaf: {
    trunk: (h) => ({ y: h * 0.25, sx: 0.4, sy: h * 0.5, sz: 0.4 }),
    crown: (h) => ({ y: h * 0.64, sx: h * 0.85, sy: h * 0.75, sz: h * 0.85 }),
  },
  acacia: {
    trunk: (h) => ({ y: h * 0.38, sx: 0.22, sy: h * 0.76, sz: 0.22 }),
    crown: (h) => ({ y: h * 0.86, sx: h * 1.6, sy: h * 0.32, sz: h * 1.6 }),
  },
  // Pine: a short bare trunk and a tall cone (the unit cone is 1 m wide and 1 m tall).
  conifer: {
    trunk: (h) => ({ y: h * 0.15, sx: 0.36, sy: h * 0.3, sz: 0.36 }),
    crown: (h) => ({ y: h * 0.6, sx: h * 0.42, sy: h * 0.8, sz: h * 0.42 }),
  },
}

const CROWN_HUE: Record<PlantKind, string> = { shrub: '#7f8a5a', olive: '#7d8b6e', broadleaf: '#4f7a3a', acacia: '#6f7d48', conifer: '#2f5236' }
/** Evergreen kinds keep their hue in every season. */
const EVERGREEN = new Set<PlantKind>(['olive', 'conifer'])
const TRUNK = '#5b4a3a'

function Vegetation({ plants, seasonColor, snow }: { plants: Placed[]; seasonColor: string; snow: boolean }) {
  const byKind = useMemo(() => {
    const m = new Map<PlantKind, Placed[]>()
    for (const p of plants) m.set(p.kind, [...(m.get(p.kind) ?? []), p])
    return [...m.entries()]
  }, [plants])
  return (
    <>
      {byKind.map(([kind, items]) => (
        <group key={kind}>
          {kind !== 'shrub' && <Instanced items={items} color={TRUNK} kind={kind} part="trunk" />}
          {/* Olives and pines keep their color all year; the others follow the season. Snow whitens them all. */}
          <Instanced
            items={items}
            color={mixColor(EVERGREEN.has(kind) ? CROWN_HUE[kind] : mixColor(CROWN_HUE[kind], seasonColor, 0.65), SNOW, snow ? 0.5 : 0)}
            kind={kind}
            part="crown"
          />
        </group>
      ))}
    </>
  )
}

function Boxes({ boxes, color, roughness = 0.9, y = 0 }: { boxes: Box[]; color: string; roughness?: number; y?: number }) {
  return (
    <>
      {boxes.map((b, i) => (
        <mesh key={i} position={[b.x, y + b.h / 2, b.z]} rotation-y={b.rotation} castShadow receiveShadow>
          <boxGeometry args={[b.w, b.h, b.d]} />
          <meshStandardMaterial color={color} roughness={roughness} />
        </mesh>
      ))}
    </>
  )
}

function Hills({ hills, color }: { hills: Box[]; color: string }) {
  return (
    <>
      {hills.map((b, i) => (
        <mesh key={i} position={[b.x, -b.h * 0.15, b.z]} rotation-y={b.rotation} scale={[b.w / 2, b.h, b.d / 2]}>
          <sphereGeometry args={[1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color={color} roughness={1} />
        </mesh>
      ))}
    </>
  )
}

/** Ficus trees in the plaza's planters: evergreen, so they keep their color in every season. */
function PlanterTrees({ planters }: { planters: Box[] }) {
  const items = useMemo(() => planters.map((p) => ({ kind: 'broadleaf' as const, x: p.x, z: p.z, y: p.h, height: 4.2, rotation: p.rotation })), [planters])
  return (
    <>
      <Instanced items={items} color={TRUNK} kind="broadleaf" part="trunk" />
      <Instanced items={items} color="#3f6a35" kind="broadleaf" part="crown" />
    </>
  )
}

function Railing({ edge, fp, length }: { edge: number; fp: Footprint; length: number }) {
  return (
    <group position={[edge + 0.3, 0, fp.z]}>
      <mesh position={[0, 1.05, 0]} castShadow>
        <boxGeometry args={[0.06, 0.06, length]} />
        <meshStandardMaterial color="#5c5f60" roughness={0.5} metalness={0.6} />
      </mesh>
      {Array.from({ length: Math.floor(length / 2.4) }, (_, i) => (
        <mesh key={i} position={[0, 0.52, -length / 2 + i * 2.4]} castShadow>
          <boxGeometry args={[0.05, 1.05, 0.05]} />
          <meshStandardMaterial color="#5c5f60" roughness={0.5} metalness={0.6} />
        </mesh>
      ))}
    </group>
  )
}

const CLOTHES = ['#2f3a4a', '#8a3b2e', '#d9d2c3', '#3d5a40', '#6b5b4b', '#1f1f22', '#b88a3a', '#55708a']
const SKIN = ['#c99a78', '#8d5d42', '#e0b896', '#a8765a', '#5e3d2c']

/** People for scale (LEVELS.md 2.4): the bare level's spots first, then more around the model. */
function People({ recipe, count, fp, seed }: { recipe: Built; count: number; fp: Footprint; seed: number }) {
  const people = useMemo(() => {
    const spots = peopleSpots(recipe).slice(0, count)
    const rand = rng(seed ^ 0x51ed)
    while (spots.length < count) {
      const a = rand() * Math.PI * 2, r = fp.radius + 1 + rand() * (MARGIN + 6)
      spots.push({ at: [fp.x + r * Math.cos(a), 0, fp.z + r * Math.sin(a)], h: 1.6 + rand() * 0.25 })
    }
    return spots.map((s, i) => ({ ...s, color: CLOTHES[i % CLOTHES.length]!, head: SKIN[Math.floor(rand() * SKIN.length)]! }))
  }, [recipe, count, fp, seed])
  return (
    <>
      {people.map((p, i) => (
        <Person key={i} at={p.at} h={p.h} color={p.color} head={p.head} />
      ))}
    </>
  )
}

/** Boulders on the slope, set on the ground and sunk a little so they do not float. */
function Rocks({ rocks, height, color }: { rocks: Box[]; height: (x: number, z: number) => number; color: string }) {
  return (
    <>
      {rocks.map((r, i) => (
        <mesh key={i} position={[r.x, height(r.x, r.z) + r.h * 0.3, r.z]} rotation={[0.3 * Math.sin(i), r.rotation, 0.2 * Math.cos(i)]} scale={[r.w / 2, r.h / 2, r.d / 2]} castShadow receiveShadow>
          <dodecahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color={color} roughness={0.95} flatShading />
        </mesh>
      ))}
    </>
  )
}

/** Street lights of the gateway: an 8 m pole and a lamp head reaching over the road. */
function Lamps({ lamps, roadZ }: { lamps: Box[]; roadZ: number }) {
  return (
    <>
      {lamps.map((l, i) => {
        const toward = Math.sign(roadZ - l.z) || 1
        return (
          <group key={i} position={[l.x, 0, l.z]}>
            <mesh position={[0, l.h / 2, 0]} castShadow>
              <boxGeometry args={[l.w, l.h, l.d]} />
              <meshStandardMaterial color="#5c5f60" roughness={0.5} metalness={0.6} />
            </mesh>
            <mesh position={[0, l.h - 0.1, toward * 0.9]} castShadow>
              <boxGeometry args={[0.3, 0.14, 1.8]} />
              <meshStandardMaterial color="#5c5f60" roughness={0.5} metalness={0.6} />
            </mesh>
          </group>
        )
      })}
    </>
  )
}

/**
 * Rain as short streaks slanted by the wind, or snow as flakes, in a box around the model. Static: the scene is
 * drawn on demand (DECISIONS.md 67), and still streaks read as rain in a photograph too.
 */
function Precipitation({ kind, center, radius, top, wind, seed }: { kind: 'rain' | 'snow'; center: [number, number]; radius: number; top: number; wind: Wind; seed: number }) {
  const geo = useMemo(() => {
    const rand = rng(seed ^ 0x7a1)
    const n = kind === 'rain' ? 5000 : 4000
    const to = ((wind.from_deg + 180) * Math.PI) / 180
    // Rain falls at about 9 m/s: it drifts speed/9 meters sideways per meter of fall. Streaks are 0.7 m long.
    const drift = Math.min(1.5, wind.speed_ms / 9)
    const dx = Math.sin(to) * drift, dz = -Math.cos(to) * drift
    const pos: number[] = []
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * radius
      const x = center[0] + r * Math.cos(a), z = center[1] + r * Math.sin(a), y = rand() * top
      if (kind === 'rain') pos.push(x, y, z, x - dx * 0.7, y + 0.7, z - dz * 0.7)
      else pos.push(x, y, z)
    }
    const g = new Geometry()
    g.setAttribute('position', new Float32BufferAttribute(pos, 3))
    return g
  }, [kind, center, radius, top, wind.from_deg, wind.speed_ms, seed])
  useEffect(() => () => geo.dispose(), [geo])
  if (kind === 'rain') {
    return (
      <lineSegments geometry={geo} frustumCulled={false}>
        <lineBasicMaterial color="#d3dbe2" transparent opacity={0.4} depthWrite={false} />
      </lineSegments>
    )
  }
  return (
    <points geometry={geo} frustumCulled={false}>
      <pointsMaterial color="#ffffff" size={0.12} sizeAttenuation transparent opacity={0.9} depthWrite={false} />
    </points>
  )
}

const WIND_VERTEX = /* glsl */ `
  attribute float dist;
  varying float vDist;
  void main() {
    vDist = dist;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const WIND_FRAGMENT = /* glsl */ `
  uniform float time;
  uniform float speed;
  uniform vec3 color;
  varying float vDist;
  void main() {
    // Dashes 6 m apart move along the line at the wind speed, so their pace is the wind's pace.
    float f = fract((vDist - time * speed) / 6.0);
    float a = smoothstep(0.0, 0.15, f) * (1.0 - smoothstep(0.35, 0.5, f));
    if (a < 0.02) discard;
    gl_FragColor = vec4(color, a * 0.95);
  }
`

/**
 * Wind lines (DECISIONS.md 122): an illustration of direction and strength at ground level and at mid height.
 * They bend around the footprint's bounding circle as ideal flow does, not around the actual shape.
 */
function WindLines({ center, radius, heights, wind, color, ground }: { center: [number, number]; radius: number; heights: number[]; wind: Wind; color: string; ground: (x: number, z: number) => number }) {
  const lines = useMemo(() => streamlines(center, radius, wind, heights), [center, radius, heights, wind.from_deg, wind.speed_ms]) // eslint-disable-line react-hooks/exhaustive-deps
  const geo = useMemo(() => {
    const pos: number[] = [], dist: number[] = []
    for (const l of lines) {
      for (let i = 0; i + 1 < l.dist.length; i++) {
        // Heights are above the local ground, so dunes and slopes do not swallow the lines.
        const [x0, y0, z0, x1, y1, z1] = l.points.slice(3 * i, 3 * i + 6) as [number, number, number, number, number, number]
        pos.push(x0, y0 + ground(x0, z0), z0, x1, y1 + ground(x1, z1), z1)
        dist.push(l.dist[i]!, l.dist[i + 1]!)
      }
    }
    const g = new Geometry()
    g.setAttribute('position', new Float32BufferAttribute(pos, 3))
    g.setAttribute('dist', new Float32BufferAttribute(dist, 1))
    return g
  }, [lines, ground])
  useEffect(() => () => geo.dispose(), [geo])
  // One material made here, not through JSX props, so the uniforms the frame loop changes are the ones drawn.
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: { time: { value: 0 }, speed: { value: 0 }, color: { value: new Color() } },
        vertexShader: WIND_VERTEX,
        fragmentShader: WIND_FRAGMENT,
        transparent: true,
        depthWrite: false,
      }),
    [],
  )
  useEffect(() => () => material.dispose(), [material])
  useLayoutEffect(() => {
    material.uniforms.speed!.value = wind.speed_ms
    ;(material.uniforms.color!.value as Color).set(color)
  }, [material, wind.speed_ms, color])
  // The only animation in the realistic level: it asks for the next frame only while the lines are shown.
  useFrame(({ invalidate }) => {
    material.uniforms.time!.value = performance.now() / 1000
    invalidate()
  })
  if (!lines.length) return null
  return (
    <lineSegments geometry={geo} material={material} frustumCulled={false} renderOrder={2} />
  )
}

const C = new Vector3(), N = new Vector3()
/**
 * "צפון" pinned to the edge of the window, where a line from the model's center toward north leaves it. The
 * word never hides behind the model, whatever the camera does.
 */
function northEdge(el: Object3D, camera: Camera, size: { width: number; height: number }): number[] {
  C.setFromMatrixPosition(el.matrixWorld)
  N.copy(C).add(new Vector3(0, 0, -10))
  C.project(camera)
  N.project(camera)
  const W = size.width, H = size.height, m = 30
  let cx = ((C.x + 1) / 2) * W, cy = ((1 - C.y) / 2) * H
  let dx = ((N.x + 1) / 2) * W - cx, dy = ((1 - N.y) / 2) * H - cy
  const L = Math.hypot(dx, dy)
  if (L < 1e-6 || C.z > 1 || N.z > 1) (dx = 0), (dy = -1)
  else (dx /= L), (dy /= L)
  cx = Math.min(W - m, Math.max(m, cx))
  cy = Math.min(H - m, Math.max(m, cy))
  const tx = dx > 0 ? (W - m - cx) / dx : dx < 0 ? (m - cx) / dx : Infinity
  const ty = dy > 0 ? (H - m - cy) / dy : dy < 0 ? (m - cy) / dy : Infinity
  const t = Math.min(tx, ty)
  return [cx + dx * t, cy + dy * t]
}

/**
 * Words in the model (DECISIONS.md 121): "צפון" at the window's north edge, and "חזית" on the ground in front of
 * the model, hidden when the model stands between it and the camera.
 */
function Compass({ fp, orientation, model }: { fp: Footprint; orientation: number; model: React.RefObject<Group | null> }) {
  const r = fp.radius + MARGIN
  const o = (orientation * Math.PI) / 180
  return (
    <>
      <Html position={[fp.x, 0, fp.z]} center zIndexRange={[20, 0]} calculatePosition={northEdge}>
        <span className="scene-word" data-testid="north-label">
          צפון
        </span>
      </Html>
      <Html position={[fp.x + Math.sin(o) * r, 0.3, fp.z - Math.cos(o) * r]} center zIndexRange={[20, 0]} occlude={[model as React.RefObject<Group>]}>
        <span className="scene-word front" data-testid="front-label">
          חזית
        </span>
      </Html>
    </>
  )
}

export function RealisticScene({ result, built, recipe }: { result: BuildSuccess | null; built: Built; recipe: Built }) {
  const showPeople = useStudio((s) => s.showPeople)
  const showWind = useStudio((s) => s.showWind)
  const recording = useStudio((s) => s.recording)
  const real = recipe.realistic
  // Size and footprint follow the mesh on screen (the last build); dressing follows the recipe being edited.
  const b = bounds(built)
  const fp = useMemo<Footprint>(() => ({ x: b.center[0], z: b.center[2], radius: b.extent }), [b.center[0], b.center[2], b.extent])
  const ext = b.extent + 12
  const size = Math.max(900, ext * 18)
  const seed = seedOf(built.meta.id)
  const orientation = orientationOf(real)
  const wind = windOfRecipe(real)

  const when = useMemo(() => new Date(real.datetime), [real.datetime])
  const sun = useMemo(() => sunAt(real.site, when), [real.site, when])
  const season = seasonOf(localTime(real.datetime, real.site).month)
  const air = atmosphere(sun.altitude, real.weather, season, b.extent)

  const context = real.context.preset as ContextId
  const def = CONTEXTS[context]
  const vegetation = VEGETATION[(real.context.vegetation ?? def.vegetation) as VegetationId]
  const height = useMemo(() => groundHeight(def, fp), [def, fp])
  const plants = useMemo(() => scatterPlants(vegetation, fp, seed, context).map((p) => ({ ...p, y: height(p.x, p.z) })), [vegetation, fp, seed, context, height])
  const elements = useMemo(() => contextElements(context, fp, seed), [context, fp, seed])
  const edge = waterEdge(context, fp)
  // Snow lies on the ground in snowy weather and in a snow field; rain darkens and polishes the ground.
  const snowy = air.snowCover || context === 'snow_field'
  const groundColor = snowy ? SNOW : tone(def.ground, season.groundTone * (1 - 0.22 * air.wetness))
  const groundKind: GroundKind = snowy ? 'snow' : GROUND_KIND[context]

  const target = useMemo(() => new Object3D(), [])
  const dist = Math.max(200, ext * 4)
  const sunPos: [number, number, number] = [b.center[0] + sun.direction[0] * dist, sun.direction[1] * dist, b.center[2] + sun.direction[2] * dist]
  const mats = real.materials
  const center = useMemo<[number, number]>(() => [fp.x, fp.z], [fp.x, fp.z])
  const windHeights = useMemo(() => [1, Math.max(2, b.top / 2)], [b.top])
  const roadZ = elements.roads[0]?.z ?? fp.z
  const model = useRef<Group>(null)

  return (
    <>
      <Sky top={air.skyTop} horizon={air.skyHorizon} sunDir={sun.direction} sunColor={air.sunColor} sunGlow={air.sunIntensity > 0 ? (real.weather === 'fog' ? 0.4 : 1) : 0} />
      <fog attach="fog" args={[air.skyHorizon, air.fogNear, air.fogFar]} />
      <hemisphereLight args={[air.ambientSky, air.ambientGround, air.ambientIntensity]} />
      <primitive object={target} position={[b.center[0], 0, b.center[2]]} />
      <directionalLight
        position={sunPos}
        target={target}
        color={air.sunColor}
        intensity={air.sunIntensity}
        castShadow={air.castShadow}
        shadow-mapSize={[2048, 2048]}
        shadow-radius={air.shadowRadius}
        shadow-blurSamples={8}
        shadow-bias={-0.0008}
        shadow-normalBias={0.12}
        shadow-camera-left={-ext * 1.6}
        shadow-camera-right={ext * 1.6}
        shadow-camera-top={ext * 1.6}
        shadow-camera-bottom={-ext * 1.6}
        shadow-camera-near={1}
        shadow-camera-far={dist * 2.5}
      />
      <Ground context={context} fp={fp} color={groundColor} size={size} kind={groundKind} roughness={0.96 - 0.5 * air.wetness} />
      {edge !== null && <Water edge={edge} fp={fp} size={size} river={riverWidth(context)} />}
      {context === 'waterfront' && edge !== null && <Railing edge={edge} fp={fp} length={fp.radius * 6} />}
      <Vegetation plants={plants} seasonColor={season.vegetation} snow={snowy} />
      <Boxes boxes={elements.facades} color="#e2dccf" roughness={0.85} />
      <Boxes boxes={elements.planters} color="#bdb4a3" />
      {elements.planters.length > 0 && <PlanterTrees planters={elements.planters} />}
      <Boxes boxes={elements.benches} color="#8a6a4a" roughness={0.8} />
      <Boxes boxes={elements.sidewalks} color={snowy ? SNOW : tone('#bdb7ab', 1 - 0.2 * air.wetness)} roughness={0.9 - 0.4 * air.wetness} />
      <Boxes boxes={elements.roads} color={tone('#4a4c4f', 1 - 0.3 * air.wetness)} roughness={0.9 - 0.6 * air.wetness} />
      <Boxes boxes={elements.marks} color="#efede6" roughness={0.6} />
      <Lamps lamps={elements.lamps} roadZ={roadZ} />
      <Rocks rocks={elements.rocks} height={height} color={snowy ? mixColor('#8d8478', SNOW, 0.5) : '#8d8478'} />
      <Hills hills={elements.hills} color={snowy ? SNOW : tone(def.ground, season.groundTone * 0.95)} />
      {/* The model turns about its own center to face the recipe's orientation (DECISIONS.md 121). */}
      <group ref={model} position={[fp.x, 0, fp.z]} rotation-y={(-orientation * Math.PI) / 180}>
        <group position={[-fp.x, 0, -fp.z]}>
          {result && (
            <>
              <DressedPart mesh={result.meshes.outer} material={mats.outer} wetness={air.wetness} />
              <DressedPart mesh={result.meshes.inner} material={mats.inner ?? mats.outer} wetness={air.wetness} />
              <DressedPart mesh={result.meshes.floor} material={mats.floor ?? mats.inner ?? mats.outer} wetness={air.wetness} />
              <DressedPart mesh={result.meshes.caps} material={mats.outer} wetness={air.wetness} />
            </>
          )}
          {showPeople && <People recipe={built} count={real.context.people ?? 0} fp={fp} seed={seed} />}
        </group>
      </group>
      {air.precipitation && <Precipitation kind={air.precipitation} center={center} radius={ext * 1.4} top={Math.max(25, b.top + 15)} wind={wind} seed={seed} />}
      {showWind && !recording && <WindLines center={center} radius={fp.radius} heights={windHeights} wind={wind} ground={height} color={snowy || real.weather === 'fog' ? '#1d6c75' : '#e8fbff'} />}
      {!recording && <Compass fp={fp} orientation={orientation} model={model} />}
    </>
  )
}
