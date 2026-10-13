/** Opens the projects of another device: the personal link carries its account (DECISIONS.md 81). */
import { useEffect, useState } from 'react'
import { connectDevice } from '../../data/supabase'
import { navigate, useParam } from '../router'
import { TopNav } from '../TopNav'

export function Connect() {
  const code = useParam('d')
  const [state, setState] = useState<{ status: 'working' } | { status: 'error'; message: string }>({ status: 'working' })
  useEffect(() => {
    if (!code) return setState({ status: 'error', message: 'בקישור חסר המפתח.' })
    connectDevice(code).then((s) => {
      // The key leaves the address bar as soon as it is used.
      history.replaceState(null, '', '#/projects')
      if (s.status === 'signed-in') navigate('projects')
      else setState({ status: 'error', message: s.status === 'error' ? s.message : 'החיבור נכשל.' })
    })
  }, [code])
  return (
    <div className="wrap">
      <TopNav crumbs={[{ label: 'חיבור מכשיר' }]} />
      <header className="screen">
        <h1>חיבור מכשיר</h1>
        <p className="lead">{state.status === 'working' ? 'פותח את הפרויקטים מהמכשיר השני' : state.message}</p>
      </header>
      {state.status === 'error' && (
        <div className="toolbar">
          <button type="button" className="primary" onClick={() => navigate('projects')}>
            לפרויקטים במכשיר הזה
          </button>
        </div>
      )}
    </div>
  )
}
