import { useEffect } from 'react'
import { flushPending } from './data/offline'
import { useRoute } from './ui/router'
import { Compare } from './ui/screens/Compare'
import { NewConcept } from './ui/screens/NewConcept'
import { Connect } from './ui/screens/Connect'
import { LibraryScreen } from './ui/screens/LibraryScreen'
import { CollectionScreen } from './ui/screens/Collection'
import { DossierScreen } from './ui/screens/Dossier'
import { Home } from './ui/screens/Home'
import { LearnScreen } from './ui/screens/Learn'
import { Workspace } from './ui/screens/Workspace'
import { ArticleScreen } from './ui/screens/Article'
import { PosterScreen } from './ui/screens/Poster'
import { Projects } from './ui/screens/Projects'
import { Studio } from './ui/screens/Studio'
import { useStudio } from './ui/store'

export function App() {
  const route = useRoute()
  // Saves made without a connection go out when it returns, and once at start.
  useEffect(() => {
    const flush = () =>
      flushPending().then(({ sent, rejected }) => {
        if (sent) useStudio.setState((s) => (s.save.status === 'queued' ? { save: { status: 'saved', at: Date.now() } } : {}))
        if (rejected.length)
          useStudio.getState().set('notice', {
            tone: 'error',
            title: 'גרסה שנשמרה במכשיר לא התקבלה בשרת',
            lines: rejected.map((r) => ({ text: `${r.note ?? 'בלי הערה'}: ${r.message}` })),
            action: 'הבנתי',
          })
      })
    void flush()
    window.addEventListener('online', flush)
    return () => window.removeEventListener('online', flush)
  }, [])
  if (route === 'learn') return <LearnScreen />
  if (route === 'project') return <Workspace />
  if (route === 'article') return <ArticleScreen />
  if (route === 'poster') return <PosterScreen />
  if (route === 'projects') return <Projects />
  if (route === 'studio') return <Studio />
  if (route === 'new') return <NewConcept />
  if (route === 'compare') return <Compare />
  if (route === 'library') return <LibraryScreen />
  if (route === 'collection') return <CollectionScreen />
  if (route === 'dossier') return <DossierScreen />
  if (route === 'connect') return <Connect />
  return <Home />
}
