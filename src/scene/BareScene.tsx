/**
 * The bare level (LEVELS.md 1.1): one light tone without texture, even light from above with a fixed sun for
 * shadow, the continuous edge in the accent color, a neutral ground with 1 m and 10 m grids, 1.75 m figures.
 */
import { Grid, Line, OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type ComponentRef } from 'react'
import { BufferAttribute, BufferGeometry, DoubleSide, Matrix4, Vector3, type Mesh as ThreeMesh, type PerspectiveCamera } from 'three'
import type { BuildSuccess } from '../engine/build'
import { sectionCut } from '../engine/sectionCut'
import type { MeshData } from '../engine/types'
import { outerRadius } from '../recipe/rules'
import type { Built, Sweep } from '../ui/params'
import { useStudio } from '../ui/store'
import { bounds, cameraPose, peopleSpots, type Vec3 } from './cameras'
import { between, boundingSphere, ease, frame, LIMITS, step, type NavStep, type Pose } from './navigation'

export const BARE = {
  // The bare level speaks the interface's language: white, three greys and black (DECISIONS.md 78).
  background: '#f2f2f2',
  ground: '#e9e9e9',
  outer: '#ffffff',
  inner: '#e9e9e9',
  floor: '#d4d4d4',
  accent: '#111111',
  tracer: '#4a4a4a',
  section: '#4a4a4a',
  person: '#111111',
}

export function useGeometry(mesh: MeshData | null) {
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

export const toPoints = (a: Float32Array, close: boolean): [number, number, number][] => {
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
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    started.current = tracing ? performance.now() : null
    invalidate()
  }, [tracing, invalidate])
  useFrame(() => {
    // The canvas draws on demand; while the tracer runs, it asks for the next frame itself.
    if (tracing) invalidate()
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

export function Person({ at, h, color = BARE.person, head = BARE.person }: { at: [number, number, number]; h: number; color?: string; head?: string }) {
  return (
    <group position={at}>
      <mesh position={[0, (h - 0.24) / 2, 0]} castShadow>
        <cylinderGeometry args={[0.16, 0.19, h - 0.24, 10]} />
        <meshStandardMaterial color={color} roughness={0.85} />
      </mesh>
      <mesh position={[0, h - 0.11, 0]} castShadow>
        <sphereGeometry args={[0.115, 12, 10]} />
        <meshStandardMaterial color={head} roughness={0.85} />
      </mesh>
    </group>
  )
}

/**
 * The live camera pose, read when a version is saved and written when one is opened. `move` takes one
 * navigation step from the buttons or the keyboard and animates it briefly (DECISIONS.md 110).
 */
export const cameraControl: {
  get: (() => { position: Vec3; target: Vec3 }) | null
  set: ((pose: { position: Vec3; target: Vec3 }) => void) | null
  move: ((s: NavStep | 'reset' | 'center') => void) | null
} = { get: null, set: null, move: null }

/** A click moves the camera for this long, then stops exactly on the step. */
const MOVE_MS = 220

export function CameraRig({ recipe, ready }: { recipe: Built; ready: boolean }) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
  const { camera } = useThree()
  const nonce = useStudio((s) => s.cameraNonce)
  const preset = useStudio((s) => s.camera)
  const set = useStudio((s) => s.set)
  const recipeRef = useRef(recipe)
  recipeRef.current = recipe
  const { gl, invalidate } = useThree()
  const anim = useRef(0)
  const stage = () => gl.domElement.closest<HTMLElement>('[data-testid=stage]')
  // The pose, rounded to millimeters, on the stage element: tests read it to check that a version reopens as saved.
  const mark = () => {
    const el = stage()
    if (el) el.dataset.camera = JSON.stringify([...camera.position.toArray(), ...(controls.current?.target.toArray() ?? [])].map((v) => Math.round(v * 1000) / 1000))
  }
  const stop = () => {
    cancelAnimationFrame(anim.current)
    anim.current = 0
    const el = stage()
    if (el) delete el.dataset.moving
  }
  useEffect(() => {
    const place = (pose: Pose) => {
      camera.position.set(...pose.position)
      controls.current?.target.set(...pose.target)
      controls.current?.update()
      invalidate()
    }
    const apply = (pose: Pose) => {
      stop()
      place(pose)
      mark()
    }
    const get = (): Pose => ({
      position: camera.position.toArray() as Vec3,
      target: (controls.current?.target.toArray() ?? [0, 0, 0]) as Vec3,
    })
    const fov = () => (camera as PerspectiveCamera).fov ?? 50
    // Where the current move is going: a click during a move adds to its end, so quick clicks are not lost.
    let goal: Pose | null = null
    const glide = (to: Pose) => {
      stop()
      const from = get()
      goal = to
      const el = stage()
      if (el) el.dataset.moving = 'true'
      const t0 = performance.now()
      const tick = () => {
        const t = Math.min(1, (performance.now() - t0) / MOVE_MS)
        if (t >= 1) return apply(to)
        place(between(from, to, ease(t)))
        anim.current = requestAnimationFrame(tick)
      }
      anim.current = requestAnimationFrame(tick)
    }
    const destination = (s: NavStep | 'reset' | 'center', from: Pose): Pose | null => {
      if (s === 'reset') {
        // Back to the chosen view; a view that is not available here falls back to eye level.
        const pose = cameraPose(recipeRef.current, useStudio.getState().camera)
        if (!('unavailable' in pose)) return pose
        const fallback = cameraPose(recipeRef.current, 'eye_level_oblique')
        return 'unavailable' in fallback ? null : fallback
      }
      if (s === 'center') {
        const m = useStudio.getState().result?.meshes
        const sphere = m ? boundingSphere([m.outer?.positions, m.inner?.positions, m.floor?.positions, m.caps?.positions]) : null
        if (!sphere) return null
        const aspect = (camera as PerspectiveCamera).aspect ?? 1.5
        // What was framed, for tests: the sphere's center and radius, the field of view and the window's aspect.
        const el = stage()
        if (el) el.dataset.frame = JSON.stringify([...sphere.center, sphere.radius, fov(), aspect].map((v) => Math.round(v * 1000) / 1000))
        return frame(from, sphere, fov(), aspect)
      }
      return step(from, s, fov())
    }
    cameraControl.get = get
    cameraControl.set = apply
    cameraControl.move = (s) => {
      const to = destination(s, anim.current && goal ? goal : get())
      if (to) glide(to)
    }
    return () => {
      stop()
      cameraControl.get = cameraControl.set = cameraControl.move = null
    }
  }, [camera, invalidate])
  // The preset is placed once per request (a load, or a camera button), and only once the model it frames is
  // built: a new recipe waits for its own build, so the view frames it and not the model it replaces.
  const valid = useStudio((s) => s.validRecipe)
  const placed = useRef('')
  useEffect(() => {
    if (!ready) return
    const key = `${nonce}|${preset}`
    if (placed.current === key) return
    const st = useStudio.getState()
    if (st.recipe && st.validRecipe !== st.recipe) return
    placed.current = key
    // A saved view wins over the preset once: the version reopens exactly as it was looked at.
    const saved = useStudio.getState().pendingView
    if (saved) {
      cameraControl.set?.(saved.camera)
      set('pendingView', null)
      return
    }
    const pose = cameraPose(recipeRef.current, preset)
    if ('unavailable' in pose) {
      set('notice', { tone: 'info', title: 'נקודת המבט הזאת לא זמינה כאן', lines: [{ text: pose.unavailable }], action: 'הבנתי' })
      return
    }
    cameraControl.set?.(pose)
  }, [nonce, preset, ready, camera, set, valid])
  // Free hands (DECISIONS.md 110): one finger or the left button orbits, two fingers, the right button or Shift
  // with a drag pan in the screen's plane, the wheel or a pinch zooms. A drag stops any move a button started.
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping={false}
      enableRotate
      enablePan
      screenSpacePanning
      enableZoom
      maxPolarAngle={LIMITS.maxPolar}
      minDistance={LIMITS.minDistance}
      maxDistance={LIMITS.maxDistance}
      onStart={stop}
      onEnd={mark}
    />
  )
}

/** `still` drops the studio's live tools (edge tracer, moving section), for side-by-side comparison. */
export function BareScene({ result, recipe, rows, still = false }: { result: BuildSuccess | null; recipe: Built; rows: number; still?: boolean }) {
  const showEdges = useStudio((s) => s.showEdges)
  const showPeople = useStudio((s) => s.showPeople)
  const sectionOn = useStudio((s) => s.sectionOn)
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
      <hemisphereLight args={['#ffffff', '#cfcfcf', 1.6]} />
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
        cellColor="#d0d0d0"
        sectionSize={10}
        sectionThickness={1.2}
        sectionColor="#a3a3a3"
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
          {!still && <Tracer result={result} rows={rows} />}
        </>
      )}
      {/* The moving section belongs to the sweep: a surface has no section to cut (DECISIONS.md 139). */}
      {sectionOn && !still && recipe.generator.type === 'sweep' && <SectionPlane recipe={recipe as Sweep} />}
      {people.map((p, i) => (
        <Person key={i} at={p.at} h={p.h} />
      ))}
    </>
  )
}
