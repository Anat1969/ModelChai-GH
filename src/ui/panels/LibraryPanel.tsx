/** The studio's "ספרייה" tab: the library of the open project, fed by what is on screen now. */
import { useMemo } from 'react'
import { parseRecipe } from '../../recipe/schema'
import { navigate } from '../router'
import type { Sweep } from '../params'
import { useStudio } from '../store'
import { LibraryView } from './LibraryView'
import { metricRows } from './MetricsPanel'

export function LibraryPanel({ onNeedSave }: { onNeedSave: () => void }) {
  const project = useStudio((s) => s.project)
  const versionId = useStudio((s) => s.versionId)
  const raw = useStudio((s) => s.validRecipe)
  const result = useStudio((s) => s.result)
  const source = useMemo(() => {
    const p = raw ? parseRecipe(raw) : null
    if (!p?.ok || p.recipe.generator.type !== 'sweep') return null
    const recipe = p.recipe as Sweep
    const metrics = result ? Object.fromEntries(metricRows(result.metrics, recipe).map((r) => [r.label, r.value.replace(/[⁦⁩]/g, '')])) : undefined
    return { recipe, versionId, metrics }
  }, [raw, result, versionId])

  if (!project)
    return (
      <div className="library" data-testid="library-empty">
        <p className="hint">הספרייה שייכת לפרויקט. שומרים גרסה ראשונה, והספרייה נפתחת: פרומפטים, ההמחשות שיוצרים מהם, ופוסט שמפרש את המושג כמבנה במקום.</p>
        <div className="toolbar compact">
          <button type="button" className="primary" onClick={onNeedSave}>
            לשמירת גרסה
          </button>
        </div>
      </div>
    )
  return (
    <>
      <div className="toolbar compact">
        <button type="button" onClick={() => navigate('library', { p: project.id })} data-testid="open-library">
          הספרייה במסך מלא
        </button>
      </div>
      <LibraryView projectId={project.id} source={source} />
    </>
  )
}
