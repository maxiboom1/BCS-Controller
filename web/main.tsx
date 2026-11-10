import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { ChevronDown, LogOut } from 'lucide-react'
import type { Route, Snapshot } from '../shared/model.ts'
import { Admin } from './admin.tsx'
import { api, ApiError } from './api.ts'
import { Notice, StatusBadge } from './components.tsx'
import { Operator } from './operator.tsx'
import brandMark from './brand-mark.svg'
import './styles.css'

function Login({ onLogin }: { onLogin: (state: Snapshot) => void }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setBusy(true)
    const form = new FormData(event.currentTarget)
    try {
      const snapshot = await api<Snapshot>('/login', 'POST', { username: form.get('username'), password: form.get('password') })
      if (snapshot.user.role === 'admin' && location.pathname === '/') history.replaceState(null, '', '/admin')
      onLogin(snapshot)
    } catch (error) { setError((error as Error).message) }
    finally { setBusy(false) }
  }
  return <main className="login-page" id="main">
    <form className="surface login-card" onSubmit={login}>
      <img className="brand-mark" src={brandMark} alt="" width="57" height="32" />
      <h1>Ultrix Controller</h1><p>Sign in to your routing workspace.</p>
      <label>Username<input name="username" autoComplete="username" autoFocus required /></label>
      <label>Password<input name="password" autoComplete="current-password" type="password" required /></label>
      {error && <Notice error>{error}</Notice>}
      <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  </main>
}

function App() {
  const [state, setState] = useState<Snapshot>()
  const [loading, setLoading] = useState(true)
  const [transport, setTransport] = useState(false)
  const [revision, setRevision] = useState(0)
  const [streamGeneration, restartStream] = useState(0)
  const [error, setError] = useState('')
  const [panelId, setPanelId] = useState('')
  const panels = state?.panels
  const panel = panels?.find(item => item.id === panelId) ?? panels?.[0]
  const activePanelId = panel?.id ?? ''
  useEffect(() => {
    if (panelId !== activePanelId) setPanelId(activePanelId)
  }, [panelId, activePanelId])
  useEffect(() => {
    api<Snapshot>('/state').then(setState).catch((err: Error) => {
      if (!(err instanceof ApiError && err.status === 401)) setError(err.message)
    }).finally(() => setLoading(false))
  }, [])
  useEffect(() => {
    if (!state?.user.id) return
    let active = true
    const events = new EventSource('/api/events')
    let timeout: ReturnType<typeof setTimeout>
    function seen() {
      setTransport(true)
      clearTimeout(timeout)
      timeout = setTimeout(() => {
        setTransport(false)
        // A new connection starts with a complete authorized snapshot.
        events.close()
        if (active) restartStream(value => value + 1)
      }, 25_000)
    }
    events.addEventListener('snapshot', event => {
      seen()
      setState(JSON.parse(event.data))
      setRevision(value => value + 1)
    })
    events.addEventListener('route', event => {
      seen()
      const route = JSON.parse(event.data) as Route
      setState(previous => previous && { ...previous, routes: [...previous.routes.filter(item => item.destinationId !== route.destinationId), route] })
    })
    events.addEventListener('heartbeat', seen)
    events.addEventListener('expired', () => { setState(undefined); setTransport(false); events.close() })
    events.onerror = () => {
      setTransport(false)
      api('/state').catch((err: Error) => {
        if (active && err instanceof ApiError && err.status === 401) setState(undefined)
      })
    }
    return () => { active = false; clearTimeout(timeout); events.close(); setTransport(false) }
  }, [state?.user.id, streamGeneration])
  const applyRoute = useCallback((route: Route, previous?: string) => {
    setState(state => {
      if (!state) return state
      const current = state.routes.find(item => item.destinationId === route.destinationId)
      if (current && current.revision !== previous && current.revision !== route.revision) return state
      return { ...state, routes: [...state.routes.filter(item => item.destinationId !== route.destinationId), route] }
    })
  }, [])
  async function signOut() {
    try { await api('/logout', 'POST'); setState(undefined) }
    catch (err) { setError((err as Error).message) }
  }
  if (loading) return <main className="login-page"><p role="status">Loading workspace…</p></main>
  if (!state) return <>{error && <Notice error>{error}</Notice>}<Login onLogin={value => { setError(''); setState(value) }} /></>
  const isAdmin = location.pathname.startsWith('/admin') && state.user.role === 'admin'
  const status = transport ? state.router : { ...state.router, state: 'offline' as const }
  return <div className={'app ' + (isAdmin ? 'admin-app' : 'operator-app')}>
    <a href="#main" className="skip">Skip to workspace</a>
    <header className="app-header">
      <a href={isAdmin ? '/admin' : '/'} className="brand">
        <img className="brand-mark" src={brandMark} alt="" width="57" height="32" />
        <strong>Ultrix Controller</strong>
      </a>
      {isAdmin && <nav aria-label="Views" className="view-nav">
        <a href="/admin" aria-current="page">Admin</a><a href="/">Operator</a>
      </nav>}
      {!isAdmin && state.panels.length > 1 && <div className="panel-picker">
        <select aria-label="Routing panel" value={activePanelId} onChange={event => setPanelId(event.target.value)}>
          {state.panels.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <ChevronDown size={15} aria-hidden="true" />
      </div>}
      <div className="header-end">
        {isAdmin && <>{state.router.mode === 'simulator' && <span className="mode-tag">Simulator</span>}
          <StatusBadge status={status} /></>}
        {!isAdmin && state.user.role === 'admin' && <a className="admin-link" href="/admin">Admin</a>}
        <span className="username" title={state.user.username}>{state.user.username}</span>
        <button type="button" className="icon-button" title="Sign out" aria-label="Sign out" onClick={signOut}><LogOut size={18} /></button></div>
    </header>
    {isAdmin ? <>{error && <Notice error>{error}</Notice>}<Admin status={status} revision={revision} /></>
      : <Operator panel={panel} state={state} status={status} error={error} update={applyRoute} />}
  </div>
}

createRoot(document.getElementById('root')!).render(<App />)

