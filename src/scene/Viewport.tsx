/** The 1:1 model window. The previous model stays on screen until the new build is ready. */
import { Canvas } from '@react-three/fiber'
import type { Sweep } from '../ui/params'
import { useStudio } from '../ui/store'
import { BareScene } from './BareScene'

export function Viewport({ recipe }: { recipe: Sweep | null }) {
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
      data-building={building}
      aria-label="חלון המודל, יחס 1:1. גרירה מסובבת, גלגלת או צביטה מקרבות."
      role="img"
    >
      {recipe && (
        <Canvas
          shadows
          dpr={[1, 2]}
          gl={{ antialias: true, preserveDrawingBuffer: true }}
          camera={{ fov: recipe.realistic.camera.fov_deg, near: 0.1, far: 3000, position: [60, 20, 60] }}
        >
          <BareScene result={result} recipe={recipe} rows={rows} />
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
