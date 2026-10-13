/**
 * Comparison (PRODUCT.md "מסכים" 4): two versions side by side, with the same camera and the same metrics,
 * and the differences marked. Orbiting either window moves both.
 */
import { OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react'
import type { BuildSuccess } from '../../engine/build'
import { createEngineClient, type EngineClient } from '../../engine/client'
import { getVersion, type VersionRow, type Vec3 } from '../../data/projects'
import { parseRecipe } from '../../recipe/schema'
import { BareScene } from '../../scene/BareScene'
import { cameraPose } from '../../scene/cameras'
import { RealisticScene } from '../../scene/RealisticScene'
import { ltr } from '../format'
import { metricRows, type MetricRow } from '../panels/MetricsPanel'
import type { Sweep } from '../params'
import { navigate, useParam } from '../router'
import type { Level } from '../store'
import { TopNav } from '../TopNav'

type Side = { version: VersionRow & { recipe: Record<string, unknown> }; recipe: Sweep; result: BuildSuccess }

/** One camera pose shared by both windows. `by` names the window that moved it last. */
interface SharedPose {
  position: Vec3
  target: Vec3
  by: string
  stamp: number
  /** Each window's request for a frame: the canvases draw on demand, so a move in one must wake the other. */
  wake: Record<string, () => void>
}

function SyncedCamera({ id, shared, el }: { id: string; shared: React.MutableRefObject<SharedPose>; el: React.RefObject<HTMLDivElement | null> }) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
  const { camera, invalidate } = useThree()
  const seen = useRef(-1)
  useEffect(() => {
    shared.current.wake[id] = invalidate
    invalidate()
    return () => void delete shared.current.wake[id]
  }, [id, invalidate, shared])
  const applying = useRef(false)
  const mark = () => {
    if (el.current) el.current.dataset.camera = JSON.stringify([...camera.position.toArray(), ...(controls.current?.target.toArray() ?? [])].map((v) => Math.round(v * 1000) / 1000))
  }
  useFrame(() => {
    const s = shared.current
    if (s.stamp === seen.current || !controls.current) return
    seen.current = s.stamp
    if (s.by === id && s.stamp > 0) return
    applying.current = true
    camera.position.set(...s.position)
    controls.current.target.set(...s.target)
    controls.current.update()
    applying.current = false
    mark()
  })
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping={false}
      maxPolarAngle={Math.PI * 0.495}
      minDistance={0.5}
      maxDistance={600}
      onChange={() => {
        // The controls report a change when they mount; until the shared pose is applied, that is not a move.
        if (applying.current || !controls.current || seen.current < 1) return
        const s = shared.current
        shared.current = { position: camera.position.toArray() as Vec3, target: controls.current.target.toArray() as Vec3, by: id, stamp: s.stamp + 1, wake: s.wake }
        seen.current = shared.current.stamp
        mark()
        for (const [other, wake] of Object.entries(s.wake)) if (other !== id) wake()
      }}
    />
  )
}

function Stage({ side, id, level, shared }: { side: Side; id: string; level: Level; shared: React.MutableRefObject<SharedPose> }) {
  const el = useRef<HTMLDivElement>(null)
  const rows = side.result.curves.path.length / 3
  return (
    <div ref={el} className="stage" data-testid="compare-stage" data-side={id} role="img" aria-label={`גרסה ${id === 'a' ? 'ראשונה' : 'שנייה'} בהשוואה, יחס 1:1`}>
      <Canvas shadows="percentage" frameloop="demand" dpr={[1, 2]} gl={{ antialias: true, preserveDrawingBuffer: true }} camera={{ fov: side.recipe.realistic.camera.fov_deg, near: 0.1, far: 3000 }}>
        {level === 'realistic' ? <RealisticScene result={side.result} built={side.recipe} recipe={side.recipe} /> : <BareScene result={side.result} recipe={side.recipe} rows={rows} still />}
        <SyncedCamera id={id} shared={shared} el={el} />
      </Canvas>
      <span className="badge">1:1</span>
    </div>
  )
}

const close = (a: number, b: number) => Math.abs(a - b) <= 0.005 * Math.max(Math.abs(a), Math.abs(b), 1e-9)

/** Metrics of both versions on one list. A metric is marked when it moved by more than half a percent. */
function diffRows(a: MetricRow[], b: MetricRow[]) {
  const keys = [...new Set([...a.map((r) => r.key), ...b.map((r) => r.key)])]
  return keys.map((key) => {
    const ra = a.find((r) => r.key === key), rb = b.find((r) => r.key === key)
    const changed =
      !ra || !rb || ra.raw === undefined || rb.raw === undefined
        ? ra?.value !== rb?.value
        : !close(ra.raw, rb.raw) || (ra.rawMax !== undefined && rb.rawMax !== undefined && !close(ra.rawMax, rb.rawMax))
    return { key, label: (ra ?? rb)!.label, a: ra?.value ?? 'אין', b: rb?.value ?? 'אין', changed }
  })
}

/** Recipe fields that differ, as dotted paths. meta is left out: ids and dates always differ. */
function diffFields(a: unknown, b: unknown, path = ''): { path: string; a: unknown; b: unknown }[] {
  if (path === 'meta') return []
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])]
    return keys.flatMap((k) => diffFields((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k))
  }
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [{ path, a, b }]
}
const show = (v: unknown) => (v === undefined ? 'אין' : typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : JSON.stringify(v))

export function Compare() {
  const ida = useParam('a'), idb = useParam('b')
  const [sides, setSides] = useState<[Side, Side] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [level, setLevel] = useState<Level>('bare')
  const shared = useRef<SharedPose>({ position: [60, 20, 60], target: [0, 0, 0], by: '', stamp: 0, wake: {} })

  useEffect(() => {
    if (!ida || !idb) {
      setError('חסרות שתי גרסאות להשוואה.')
      return
    }
    // A Worker of its own: comparison never touches the studio's build queue or its counter.
    const engine: EngineClient = createEngineClient(new Worker(new URL('../../engine/worker.ts', import.meta.url), { type: 'module' }))
    let live = true
    ;(async () => {
      const versions = await Promise.all([getVersion(ida), getVersion(idb)])
      const built: Side[] = []
      for (const v of versions) {
        const p = parseRecipe(v.recipe)
        if (!p.ok || p.recipe.generator.type !== 'sweep') throw new Error('אחת הגרסאות אינה מתכון שהמנוע בונה')
        const out = await engine.build(v.recipe)
        if (out.status !== 'done' || !out.result.ok) throw new Error('אחת הגרסאות לא נבנתה')
        built.push({ version: v, recipe: p.recipe as Sweep, result: out.result })
      }
      if (!live) return
      const first = built[0]!
      const pose = first.version.view?.camera ?? cameraPose(first.recipe, 'eye_level_oblique')
      if ('unavailable' in pose) throw new Error(pose.unavailable)
      shared.current = { ...shared.current, position: pose.position, target: pose.target, by: '', stamp: 1 }
      setLevel(first.version.view?.level ?? 'bare')
      setSides([built[0]!, built[1]!])
    })().catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      live = false
      engine.dispose()
    }
  }, [ida, idb])

  const metrics = useMemo(
    () => (sides ? diffRows(metricRows(sides[0].result.metrics, sides[0].recipe), metricRows(sides[1].result.metrics, sides[1].recipe)) : []),
    [sides],
  )
  const fields = useMemo(() => (sides ? diffFields(sides[0].version.recipe, sides[1].version.recipe) : []), [sides])
  const changed = metrics.filter((m) => m.changed).length
  const title = sides?.[0].version.recipe && (sides[0].recipe.narrative.name_he ?? '')

  return (
    <div className="wrap">
      <TopNav />
      <nav className="crumbs" aria-label="מיקום">
        <ol>
          <li>
            <a href="#/projects" onClick={(e) => (e.preventDefault(), navigate('projects'))}>
              פרויקטים
            </a>
          </li>
          <li>{title || 'פרויקט'}</li>
          <li aria-current="page">השוואה</li>
        </ol>
      </nav>
      <header className="screen">
        <span className="eyebrow">השוואה</span>
        <h1>שתי גרסאות, אותה מצלמה</h1>
        <p className="lead">סיבוב או קירוב באחד החלונות מזיז את שניהם. המדדים שהשתנו ביותר מחצי אחוז מודגשים.</p>
      </header>

      {error && (
        <div className="notice error" role="alert" data-testid="compare-error">
          <p>{error}</p>
          <button type="button" onClick={() => navigate('projects')}>
            חזרה לפרויקטים
          </button>
        </div>
      )}
      {!sides && !error && (
        <p className="hint" role="status">
          בונה את שתי הגרסאות
        </p>
      )}
      {sides && (
        <>
          <div className="tabs compare-level" role="tablist" aria-label="רמת המחשה">
            <button type="button" role="tab" aria-selected={level === 'bare'} onClick={() => setLevel('bare')} data-testid="compare-bare">
              ערום
            </button>
            <button type="button" role="tab" aria-selected={level === 'realistic'} onClick={() => setLevel('realistic')} data-testid="compare-realistic">
              ריאליסטי
            </button>
          </div>
          <div className="compare">
            {sides.map((s, i) => (
              <figure key={s.version.id} className="compare-side">
                <Stage side={s} id={i ? 'b' : 'a'} level={level} shared={shared} />
                <figcaption>
                  <strong>{i ? 'אחרי' : 'לפני'}</strong>
                  {s.version.note ? `: ${s.version.note}` : ''}{' '}
                  <span className="hint">{new Date(s.version.created_at).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}</span>{' '}
                  <button type="button" onClick={() => navigate('studio', { v: s.version.id })}>
                    פתיחה בסטודיו
                  </button>
                </figcaption>
              </figure>
            ))}
          </div>

          <section className="panel" aria-labelledby="diff-title">
            <h2 id="diff-title">מדדים: {changed === 0 ? 'אין הבדל' : changed === 1 ? 'מדד אחד השתנה' : `${changed} מדדים השתנו`}</h2>
            <table className="diff" data-testid="metric-diff">
              <thead>
                <tr>
                  <th scope="col">מדד</th>
                  <th scope="col">לפני</th>
                  <th scope="col">אחרי</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((m) => (
                  <tr key={m.key} className={m.changed ? 'changed' : undefined} data-metric={m.key} data-changed={m.changed}>
                    <th scope="row">{m.label}</th>
                    <td>{m.a}</td>
                    <td>{m.b}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="panel" aria-labelledby="fields-title">
            <h2 id="fields-title">מה השתנה במתכון</h2>
            {fields.length === 0 ? (
              <p className="hint">המתכונים זהים.</p>
            ) : (
              <ul className="fields" data-testid="field-diff">
                {fields.map((f) => (
                  <li key={f.path}>
                    {ltr(`${f.path}: ${show(f.a)} → ${show(f.b)}`)}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}
