/**
 * The bare level (LEVELS.md 1.1): one light tone without texture, even light from above with a fixed sun for
 * shadow, the continuous edge in the accent color, a neutral ground with 1 m and 10 m grids, 1.75 m figures.
 */
import { Grid, Line, OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type ComponentRef } from 'react'
import { BufferAttribute, BufferGeometry, DoubleSide, Matrix4, Vector3, type Mesh as ThreeMesh } from 'three'
import type { BuildSuccess } from '../engine/build'
import { sectionCut } from '../engine/sectionCut'
import type { MeshData } from '../engine/types'
import { outerRadius } from '../recipe/rules'
import type { Sweep } from '../ui/params'
import { useStudio } from '../ui/store'
import { bounds, cameraPose, peopleSpots } from './cameras'

export const BARE = {
  background: '#e4e1da',
  ground: '#d9d4ca',
  outer: '#d8d2c6',
  inner: '#cfc8bb',
  floor: '#b9b2a5',
  accent: '#1d6c75',
  tracer: '#2bb3c0',
  section: '#9a5a12',
  person: '#3b3631',
}

function useGeometry(mesh: MeshData | null) {
  const geo = useMemo(() => {
    if (!mesh || !mesh.indices.length) return null
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(mesh.positions, 3))
    g.setAttribute('normal', new BufferAttribute(mesh.normals, 3))
    g.setIndex(new BufferAttribute(mesh.indices, 1))
    g.computeBoundingSphere()
    return g
  }, [mesh])
  useEffect(() => () => geo?.dispose(), [geo])
  return geo
}

function Part({ mesh, color, roughness = 0.8 }: { mesh: MeshData | null; color: string; roughness?: number }) {
  const geo = useGeometry(mesh)
  if (!geo) return null
  return (
    <mesh geometry={geo} castShadow receiveShadow>
      <meshStandardMaterial color={color} roughness={roughness} metalness={0} side={DoubleSide} />
    </mesh>
  )
}

const toPoints = (a: Float32Array, close: boolean): [number, number, number][] => {
  const pts: [number, number, number][] = []
  for (let i = 0; i < a.length; i += 3) pts.push([a[i]!, a[i + 1]!, a[i + 2]!])
  if (close && pts.length) pts.push(pts[0]!)
  return pts
}

function Edges({ result }: { result: BuildSuccess }) {
  const lines = useMemo(() => result.curves.edges.map((e) => toPoints(e, result.curves.edgesClosed)), [result])
  return (
    <>
      {lines.map((pts, i) => (
        <Line key={i} points={pts} color={BARE.accent} lineWidth={3.5} />
      ))}
    </>
  )
}

const TRACE_MS = 12000

function Tracer({ result, rows }: { result: BuildSuccess; rows: number }) {
  const ref = useRef<ThreeMesh>(null)
  const started = useRef<number | null>(null)
  const tracing = useStudio((s) => s.tracing)
  const set = useStudio((s) => s.set)
  const edge = result.curves.edges[0]
  const count = result.metrics.edgeCount
  const laps = edge ? Math.max(1, Math.round(edge.length / 3 / rows)) : 1
  useEffect(() => {
    started.current = tracing ? performance.now() : null
  }, [tracing])
  useFrame(() => {
    if (!ref.current || !edge) return
    ref.current.visible = tracing
    if (!tracing || started.current === null) return
    const f = (performance.now() - started.current) / TRACE_MS
    const n = edge.length / 3
    const i = Math.min(n - 1, Math.floor(Math.min(1, f) * n)) * 3
    ref.current.position.set(edge[i]!, edge[i + 1]!, edge[i + 2]!)
    let status: string
    if (f >= 1) {
      status = count === 1 && laps > 1 ? `חזרה להתחלה: קצה אחד, ${laps} הקפות.` : `חזרה להתחלה אחרי הקפה אחת.${count > 1 ? ` יש עוד ${count - 1} קצוות נפרדים.` : ''}`
      if (f > 1.3) set('tracing', false)
    } else {
      status = laps > 1 ? `הקפה ${Math.floor(f * laps) + 1} מתוך ${laps}` : 'הקצה סוגר מעגל בהקפה אחת'
    }
    if (useStudio.getState().traceStatus !== status) set('traceStatus', status)
  })
  return (
    <mesh ref={ref} visible={false}>
      <sphereGeometry args={[0.45, 20, 14]} />
      <meshBasicMaterial color={BARE.tracer} />
    </mesh>
  )
}

function SectionPlane({ recipe }: { recipe: Sweep }) {
  const t = useStudio((s) => s.sectionT)
  const cut = useMemo(() => sectionCut(recipe, recipe.generator.params, t), [recipe, t])
  const size = outerRadius(recipe.generator.params.section) * 2.8
  const matrix = useMemo(() => {
    const N = new Vector3(...cut.N), B = new Vector3(...cut.B)
    return new Matrix4().makeBasis(N, B, new Vector3().crossVectors(N, B)).setPosition(...cut.center)
  }, [cut])
  return (
    <group>
      <mesh matrixAutoUpdate={false} matrix={matrix}>
        <planeGeometry args={[size, size]} />
        <meshBasicMaterial color={BARE.section} transparent opacity={0.12} side={DoubleSide} depthWrite={false} />
      </mesh>
      <Line points={toPoints(cut.outer, true)} color={BARE.section} lineWidth={3} />
      {cut.inner && <Line points={toPoints(cut.inner, true)} color={BARE.section} lineWidth={2} dashed dashSize={0.3} gapSize={0.2} />}
      {cut.floor && <Line points={[cut.floor.a, cut.floor.b]} color={BARE.accent} lineWidth={3} />}
    </group>
  )
}

function Person({ at, h }: { at: [number, number, number]; h: number }) {
  return (
    <group position={at}>
      <mesh position={[0, (h - 0.24) / 2, 0]} castShadow>
        <cylinderGeometry args={[0.16, 0.19, h - 0.24, 10]} />
        <meshStandardMaterial color={BARE.person} roughness={0.85} />
      </mesh>
      <mesh position={[0, h - 0.11, 0]} castShadow>
        <sphereGeometry args={[0.115, 12, 10]} />
        <meshStandardMaterial color={BARE.person} roughness={0.85} />
      </mesh>
    </group>
  )
}

function CameraRig({ recipe, ready }: { recipe: Sweep; ready: boolean }) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
  const { camera } = useThree()
  const nonce = useStudio((s) => s.cameraNonce)
  const preset = useStudio((s) => s.camera)
  const set = useStudio((s) => s.set)
  const recipeRef = useRef(recipe)
  recipeRef.current = recipe
  useEffect(() => {
    if (!ready) return
    const pose = cameraPose(recipeRef.current, preset)
    if ('unavailable' in pose) {
      set('notice', { tone: 'info', title: 'נקודת המבט הזאת לא זמינה כאן', lines: [{ text: pose.unavailable }], action: 'הבנתי' })
      return
    }
    camera.position.set(...pose.position)
    controls.current?.target.set(...pose.target)
    controls.current?.update()
  }, [nonce, preset, ready, camera, set])
  return <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.08} maxPolarAngle={Math.PI * 0.495} minDistance={0.5} maxDistance={600} />
}

/** The renderer, kept for the PNG snapshot. */
export const viewport: { canvas: HTMLCanvasElement | null } = { canvas: null }

export function BareScene({ result, recipe, rows }: { result: BuildSuccess | null; recipe: Sweep; rows: number }) {
  const showEdges = useStudio((s) => s.showEdges)
  const showPeople = useStudio((s) => s.showPeople)
  const sectionOn = useStudio((s) => s.sectionOn)
  const { gl } = useThree()
  viewport.canvas = gl.domElement

  // Size-dependent scene pieces follow the last built recipe, not the one being edited.
  const b = bounds(recipe)
  const ext = b.extent + 12
  const sun = useMemo(() => {
    // A fixed sun, high and from the side of the default eye-level camera, so the faces we look at are lit and
    // the shadow falls behind the model, where it reads the form.
    const el = (48 * Math.PI) / 180, az = 0.55
    return new Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).multiplyScalar(Math.max(150, ext * 3))
  }, [ext])
  const people = useMemo(() => (showPeople ? peopleSpots(recipe) : []), [recipe, showPeople])

  return (
    <>
      <color attach="background" args={[BARE.background]} />
      <hemisphereLight args={['#f6f4ef', '#c9c2b4', 1.6]} />
      <directionalLight
        position={sun}
        intensity={2.3}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0008}
        shadow-normalBias={0.12}
        shadow-camera-left={-ext}
        shadow-camera-right={ext}
        shadow-camera-top={ext}
        shadow-camera-bottom={-ext}
        shadow-camera-near={1}
        shadow-camera-far={Math.max(400, ext * 8)}
      />
      <mesh rotation-x={-Math.PI / 2} receiveShadow position={[b.center[0], 0, b.center[2]]}>
        <planeGeometry args={[ext * 12, ext * 12]} />
        <meshStandardMaterial color={BARE.ground} roughness={1} />
      </mesh>
      <Grid
        position={[b.center[0], 0.01, b.center[2]]}
        args={[ext * 12, ext * 12]}
        cellSize={1}
        cellThickness={0.6}
        cellColor="#bdb6a8"
        sectionSize={10}
        sectionThickness={1.2}
        sectionColor="#8f877a"
        fadeDistance={ext * 5}
        fadeStrength={1.5}
      />
      {result && (
        <>
          <Part mesh={result.meshes.outer} color={BARE.outer} />
          <Part mesh={result.meshes.inner} color={BARE.inner} />
          <Part mesh={result.meshes.floor} color={BARE.floor} />
          <Part mesh={result.meshes.caps} color={BARE.outer} />
          {showEdges && <Edges result={result} />}
          <Tracer result={result} rows={rows} />
        </>
      )}
      {sectionOn && <SectionPlane recipe={recipe} />}
      {people.map((p, i) => (
        <Person key={i} at={p.at} h={p.h} />
      ))}
      <CameraRig recipe={recipe} ready={!!result} />
    </>
  )
}
