/** The 1:1 model window. The previous model stays on screen until the new build is ready. */
import { Canvas } from '@react-three/fiber'
import type { Sweep } from '../ui/params'
import { useStudio } from '../ui/store'
import { BareScene, CameraRig } from './BareScene'
import { RealisticScene } from './RealisticScene'
import { engine } from '../ui/engine'

/** The renderer, kept for the PNG snapshot. */
export const viewport: { canvas: HTMLCanvasElement | null } = { canvas: null }

/**
 * `built` is the recipe of the mesh on screen; `recipe` is the one being edited. The realistic level dresses
 * the built mesh with the edited recipe's `realistic` fields, which never need a new build.
 */
export function Viewport({ recipe, built }: { recipe: Sweep | null; built: Sweep | null }) {
  const level = useStudio((s) => s.level)
  const result = useStudio((s) => s.result)
  const building = useStudio((s) => s.building)
  const modelVersion = useStudio((s) => s.modelVersion)
  const traceStatus = useStudio((s) => s.traceStatus)
  const tracing = useStudio((s) => s.tracing)
  const rows = result ? result.curves.path.length / 3 : 1

  return (
    <div
      className="stage"
      data-testid="stage"
      data-model-version={modelVersion}
      data-build-count={engine.buildCount}
      data-level={level}
      data-building={building}
      aria-label="חלון המודל, יחס 1:1. גרירה מסובבת, גלגלת או צביטה מקרבות."
      role="img"
    >
      {built && recipe && (
        <Canvas
          shadows="percentage"
          onCreated={({ gl }) => (viewport.canvas = gl.domElement)}
          dpr={[1, 2]}
          gl={{ antialias: true, preserveDrawingBuffer: true }}
          camera={{ fov: recipe.realistic.camera.fov_deg, near: 0.1, far: 3000, position: [60, 20, 60] }}
        >
          {level === 'realistic' ? <RealisticScene result={result} built={built} recipe={recipe} /> : <BareScene result={result} recipe={built} rows={rows} />}
          <CameraRig recipe={built} ready={!!result} />
        </Canvas>
      )}
      <span className="badge">1:1</span>
      {building && result && (
        <span className="badge end" role="status">
          מעדכן את המודל
        </span>
      )}
      {!result && (
        <div className="stage-empty" role="status">
          בונה את המודל מהמתכון
        </div>
      )}
      {tracing && traceStatus && (
        <span className="stage-status" role="status">
          {traceStatus}
        </span>
      )}
    </div>
  )
}
