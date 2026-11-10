import { useEffect, useState } from 'react'
import type { OnlineSession } from '../shared/model.ts'
import { api } from './api.ts'
import { Notice } from './components.tsx'

function idleTime(now: number, lastActivityAt: number) {
  const seconds = Math.max(0, Math.floor((now - lastActivityAt) / 1000))
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(value => String(value).padStart(2, '0')).join(':')
}

export function SessionStatus() {
  const [sessions, setSessions] = useState<OnlineSession[]>()
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    let loading = false
    async function refresh() {
      if (loading) return
      loading = true
      try {
        setSessions(await api<OnlineSession[]>('/admin/sessions', 'GET', undefined, controller.signal))
        setError('')
      } catch (error) {
        if (!controller.signal.aborted) setError((error as Error).message)
      } finally { loading = false }
    }
    void refresh()
    const poll = setInterval(() => { if (!document.hidden) void refresh() }, 5000)
    const clock = setInterval(() => setNow(Date.now()), 1000)
    return () => { controller.abort(); clearInterval(poll); clearInterval(clock) }
  }, [])

  async function disconnect(session: OnlineSession) {
    if (!window.confirm('Sign out ' + session.username + (session.current ? ' from this browser' : '') + '?')) return
    setBusy(session.id)
    setError('')
    try {
      await api('/admin/sessions/' + session.id, 'DELETE')
      setSessions(previous => previous?.filter(row => row.id !== session.id))
    } catch (error) { setError((error as Error).message) }
    finally { setBusy('') }
  }

  return <>
    {error && <Notice error>{error}</Notice>}
    <div className="surface table-scroll"><table><thead><tr>
      <th>User</th><th>Client IP</th><th>Browser</th><th>Idle</th><th><span className="sr-only">Actions</span></th>
    </tr></thead><tbody>
      {sessions?.map(session => <tr key={session.id}>
        <td>{session.username}{session.current && <small className="muted"> · This session</small>}</td>
        <td>{session.ip}</td><td>{session.browser}</td><td>{idleTime(now, session.lastActivityAt)}</td>
        <td><button className="danger-button" type="button" disabled={!!busy} onClick={() => void disconnect(session)}
          aria-label={'Disconnect session for ' + session.username}>Disconnect session</button></td>
      </tr>)}
      {!sessions?.length && <tr><td colSpan={5} className="empty-cell">{sessions ? 'No online sessions.' : 'Loading sessions…'}</td></tr>}
    </tbody></table></div>
  </>
}
