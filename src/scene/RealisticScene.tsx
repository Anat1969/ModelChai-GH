/**
 * The realistic level (LEVELS.md 2): the same mesh as the bare level, dressed in material, sun, season,
 * weather and context. Nothing here asks the Worker for geometry: every input is either the last build or a
 * field under `realistic` (CLAUDE.md, "הפרדת רמות").
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  BackSide,
  BufferAttribute,
  Color,
  DoubleSide,
  Object3D,
  PlaneGeometry,
  type BufferGeometry,
  type InstancedMesh,
} from 'three'
import type { BuildSuccess } from '../engine/build'
import { MATERIAL_LOOK } from '../engine/materials'
import type { MeshData } from '../engine/types'
import type { Sweep } from '../ui/params'
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
import { GROUND_TILE, groundTexture, materialTexture, type GroundKind, type MaterialId } from './materials/textures'
import { seasonOf } from './seasons'
import { localTime, sunAt } from './sun'

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

function DressedPart({ mesh, material }: { mesh: MeshData | null; material: MaterialId }) {
  const geo = useGeometry(mesh)
  const uvGeo = useMemo(() => (geo ? withBoxUv(geo) : null), [geo])
  const look = MATERIAL_LOOK[material]
  const map = useMemo(() => materialTexture(material), [material])
  if (!uvGeo) return null
  const glass = material === 'glass_clear'
  return (
    <mesh geometry={uvGeo} castShadow={!glass} receiveShadow>
      <meshStandardMaterial
        color={look.color}
        roughness={look.roughness}
        metalness={look.metalness}
        map={glass ? null : map}
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
}

function Ground({ context, fp, color, size }: { context: ContextId; fp: Footprint; color: string; size: number }) {
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
  const map = useMemo(() => groundTexture(GROUND_KIND[context]), [context])
  return (
    <mesh geometry={geo} receiveShadow>
      <meshStandardMaterial color={color} roughness={0.96} map={map} />
    </mesh>
  )
}

function Water({ edge, fp, size }: { edge: number; fp: Footprint; size: number }) {
  const width = size / 2 + (edge - fp.x)
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
      {part === 'trunk' ? <cylinderGeometry args={[0.5, 0.7, 1, 7]} /> : <icosahedronGeometry args={[0.5, 1]} />}
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
}

const CROWN_HUE: Record<PlantKind, string> = { shrub: '#7f8a5a', olive: '#7d8b6e', broadleaf: '#4f7a3a', acacia: '#6f7d48' }
const TRUNK = '#5b4a3a'

function Vegetation({ plants, seasonColor }: { plants: Placed[]; seasonColor: string }) {
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
          {/* Olive trees keep their grey-green all year; the others follow the season. */}
          <Instanced items={items} color={kind === 'olive' ? CROWN_HUE.olive : mixColor(CROWN_HUE[kind], seasonColor, 0.65)} kind={kind} part="crown" />
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
function People({ recipe, count, fp, seed }: { recipe: Sweep; count: number; fp: Footprint; seed: number }) {
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

export function RealisticScene({ result, built, recipe }: { result: BuildSuccess | null; built: Sweep; recipe: Sweep }) {
  const showPeople = useStudio((s) => s.showPeople)
  const real = recipe.realistic
  // Size and footprint follow the mesh on screen (the last build); dressing follows the recipe being edited.
  const b = bounds(built)
  const fp = useMemo<Footprint>(() => ({ x: b.center[0], z: b.center[2], radius: b.extent }), [b.center[0], b.center[2], b.extent])
  const ext = b.extent + 12
  const size = Math.max(900, ext * 18)
  const seed = seedOf(built.meta.id)

  const when = useMemo(() => new Date(real.datetime), [real.datetime])
  const sun = useMemo(() => sunAt(real.site, when), [real.site, when])
  const season = seasonOf(localTime(real.datetime, real.site).month)
  const air = atmosphere(sun.altitude, real.weather, season, b.extent)

  const context = real.context.preset as ContextId
  const def = CONTEXTS[context]
  const vegetation = VEGETATION[(real.context.vegetation ?? def.vegetation) as VegetationId]
  const height = useMemo(() => groundHeight(def, fp), [def, fp])
  const plants = useMemo(() => scatterPlants(vegetation, fp, seed).map((p) => ({ ...p, y: height(p.x, p.z) })), [vegetation, fp, seed, height])
  const elements = useMemo(() => contextElements(context, fp, seed), [context, fp, seed])
  const edge = waterEdge(context, fp)
  const groundColor = tone(def.ground, season.groundTone)

  const target = useMemo(() => new Object3D(), [])
  const dist = Math.max(200, ext * 4)
  const sunPos: [number, number, number] = [b.center[0] + sun.direction[0] * dist, sun.direction[1] * dist, b.center[2] + sun.direction[2] * dist]
  const mats = real.materials

  return (
    <>
      <Sky top={air.skyTop} horizon={air.skyHorizon} sunDir={sun.direction} sunColor={air.sunColor} sunGlow={air.sunIntensity > 0 ? 1 : 0} />
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
      <Ground context={context} fp={fp} color={groundColor} size={size} />
      {edge !== null && <Water edge={edge} fp={fp} size={size} />}
      {context === 'waterfront' && edge !== null && <Railing edge={edge} fp={fp} length={fp.radius * 6} />}
      <Vegetation plants={plants} seasonColor={season.vegetation} />
      <Boxes boxes={elements.facades} color="#e2dccf" roughness={0.85} />
      <Boxes boxes={elements.planters} color="#bdb4a3" />
      {elements.planters.length > 0 && <PlanterTrees planters={elements.planters} />}
      <Boxes boxes={elements.benches} color="#8a6a4a" roughness={0.8} />
      <Hills hills={elements.hills} color={tone(def.ground, season.groundTone * 0.95)} />
      {result && (
        <>
          <DressedPart mesh={result.meshes.outer} material={mats.outer} />
          <DressedPart mesh={result.meshes.inner} material={mats.inner ?? mats.outer} />
          <DressedPart mesh={result.meshes.floor} material={mats.floor ?? mats.inner ?? mats.outer} />
          <DressedPart mesh={result.meshes.caps} material={mats.outer} />
        </>
      )}
      {showPeople && <People recipe={built} count={real.context.people ?? 0} fp={fp} seed={seed} />}
    </>
  )
}
