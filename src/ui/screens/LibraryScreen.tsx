/**
 * The concept's library on its own screen: the post as an editorial piece, then the prompts and their images.
 * The post and the current prompt come from the project's newest version.
 */
import { useEffect, useState } from 'react'
import { projectWithLatest } from '../../data/library'
import type { ProjectRow } from '../../data/projects'
import { ensureSession, type SessionState } from '../../data/supabase'
import { parseRecipe } from '../../recipe/schema'
import { EmailLogin } from '../panels/EmailLogin'
import { LibraryView, type LibrarySource } from '../panels/LibraryView'
import type { Sweep } from '../params'
import { navigate, useParam } from '../router'
import { TopNav } from '../TopNav'

export function LibraryScreen() {
  const projectId = useParam('p')
  const [session, setSession] = useState<SessionState | null>(null)
  const [project, setProject] = useState<ProjectRow | null>(null)
  const [source, setSource] = useState<LibrarySource | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId) return setError('חסר פרויקט.')
    ensureSession().then(async (s) => {
      setSession(s)
      if (s.status !== 'signed-in') return
      try {
        const { project, latest } = await projectWithLatest(projectId)
        setProject(project)
        const p = latest ? parseRecipe(latest.recipe) : null
        setSource(p?.ok && p.recipe.generator.type === 'sweep' ? { recipe: p.recipe as Sweep, versionId: latest!.id } : null)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })
  }, [projectId])

  const title = source?.recipe.narrative.name_he ?? project?.title_he ?? 'ספרייה'
  return (
    <div className="wrap">
      <TopNav crumbs={[{ label: 'פרויקטים', to: 'projects' }, { label: project?.title_he ?? 'פרויקט' }, { label: 'ספרייה' }]} />
      <header className="screen">
        <span className="eyebrow">ספרייה · {source ? [source.recipe.concept.name_he, source.recipe.concept.name].join(' · ') : project?.concept}</span>
        <h1>{title}</h1>
        {source?.recipe.narrative.maxim && <p className="lead">{source.recipe.narrative.maxim}</p>}
        {source && (
          <div className="toolbar compact">
            <button type="button" onClick={() => navigate('studio', { v: source.versionId! })}>
              פתיחה בסטודיו
            </button>
            <button type="button" onClick={() => navigate('collection', { p: projectId! })}>
              קולקציה
            </button>
          </div>
        )}
      </header>
      {session?.status === 'needs-email' && <EmailLogin why="הספרייה שמורה בחשבון." />}
      {error && (
        <div className="notice error" role="alert">
          <p>{error}</p>
          <button type="button" onClick={() => navigate('projects')}>
            חזרה לפרויקטים
          </button>
        </div>
      )}
      {projectId && session?.status === 'signed-in' && <LibraryView projectId={projectId} source={source} wide />}
    </div>
  )
}
