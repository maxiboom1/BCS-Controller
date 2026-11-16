import { useEffect, useState } from 'react'
import { Grid2X2, Monitor, Plus, Settings, Tags, Users } from 'lucide-react'
import type { AdminPanelView, RouterStatus, User } from '../shared/model.ts'
import { api, ApiError } from './api.ts'
import { elapsedClock, Notice, SearchBox } from './components.tsx'
import { PanelEditor, UserEditor } from './adminEditors.tsx'
import { LabelsTab } from './labels.tsx'
import { SettingsTab } from './settings.tsx'
import { SessionStatus } from './sessionStatus.tsx'

const tabs = [
  ['Users', Users], ['Panels', Grid2X2], ['Labels', Tags], ['Clients', Monitor], ['Settings', Settings],
] as const
type Tab = typeof tabs[number][0]
type AdminData = { users: User[]; panels: AdminPanelView[]; version: string }

function AdminFooter({ status, version }: { status: RouterStatus; version?: string }) {
  const connectedAt = status.state === 'live' ? status.connectedAt : null
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (connectedAt === null) return
    setNow(Date.now())
    const clock = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(clock)
  }, [connectedAt])
  const uptime = connectedAt === null ? '—' : elapsedClock(now, connectedAt)
  return <footer className="admin-footer" aria-label="Server status">
    <span>BCS {status.endpoint}</span>
    <span>Uptime <span aria-label="Connection uptime">{uptime}</span></span>
    {version && <span>Ultrix {version}</span>}
  </footer>
}

export function Admin({ status, revision, currentUserId, appError }: {
  status: RouterStatus; revision: number; currentUserId: string; appError: string
}) {
  const [tab, setTab] = useState<Tab>('Users')
  const [data, setData] = useState<AdminData>()
  const [local, setLocal] = useState(0)
  const [editing, setEditing] = useState<string>()
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    api<AdminData>('/admin', 'GET', undefined, controller.signal).then(result => {
      if (!controller.signal.aborted) {
        setData(result)
        setLoadError('')
      }
    }).catch((err: Error) => { if (!controller.signal.aborted) setLoadError(err.message) })
    return () => controller.abort()
  }, [revision, local])

  const user = tab === 'Users' ? data?.users.find(item => item.id === editing) : undefined
  const panel = tab === 'Panels' ? data?.panels.find(item => item.id === editing) : undefined
  const targetDeleted = Boolean(editing && editing !== 'new' && data && !user && !panel)
  useEffect(() => {
    if (targetDeleted) {
      setError(tab === 'Users' ? 'User was deleted.' : 'Panel was deleted.')
      setEditing(undefined)
    }
  }, [targetDeleted, tab])

  function closeEditor() { setEditing(undefined) }
  function refresh() { setLocal(value => value + 1) }
  function save() { closeEditor(); refresh() }
  function missing(message: string) { setError(message); save() }

  async function remove(kind: 'users' | 'panels', id: string, message: string) {
    if (!window.confirm(message)) return
    setError('')
    setDeleting(true)
    try { await api('/admin/' + kind + '/' + id, 'DELETE') }
    catch (err) { setError((err as Error).message) }
    finally { refresh(); setDeleting(false) }
  }

  const needle = query.toLowerCase()
  const users = data?.users.filter(item => item.username.toLowerCase().includes(needle)) ?? []
  const panels = data?.panels.filter(item => item.name.toLowerCase().includes(needle)) ?? []
  const enabledAdmins = data?.users.filter(item => item.role === 'admin' && item.enabled).length ?? 0
  const assignedUsers = new Map<string, number>()
  for (const item of data?.users ?? []) {
    for (const id of item.panelIds) assignedUsers.set(id, (assignedUsers.get(id) ?? 0) + 1)
  }
  const editorVisible = Boolean(editing && !targetDeleted)

  return <div className="admin-layout">
    <aside className="sidebar"><nav aria-label="Admin sections">{tabs.map(([name, Icon]) =>
      <button key={name} type="button" aria-current={tab === name ? 'page' : undefined} onClick={() => {
        if (name === tab) return
        setTab(name); closeEditor(); setQuery(''); setError('')
      }}><Icon size={18} aria-hidden="true" />{name}</button>)}</nav></aside>
    <main className="admin-main" id="main" aria-label={tab}>
      {(appError || error || loadError) && <Notice error>{appError || error || loadError}</Notice>}
      {tab === 'Settings' && <SettingsTab />}
      {tab === 'Clients' && <SessionStatus />}
      {tab === 'Labels' && <LabelsTab refresh={revision} />}
      {data && tab === 'Users' && (editorVisible
        ? <UserEditor key={editing} user={user} panels={data.panels} done={save} cancel={closeEditor} missing={missing} />
        : <div className="admin-view">
          <div className="toolbar"><SearchBox value={query} onChange={setQuery} label="Search users" /></div>
          <div className="table-scroll"><table aria-label="Users"><thead><tr>
            <th>Username</th><th>Role</th><th>Panels</th><th>Account</th><th><span className="sr-only">Actions</span></th>
          </tr></thead><tbody>
            {users.map(item => {
              const protectedAccount = item.id === currentUserId || (item.role === 'admin' && item.enabled && enabledAdmins <= 1)
              return <tr key={item.id}>
                <td>{item.username}</td><td className="capitalize">{item.role}</td><td>{item.panelIds.length}</td>
                <td><span className={'pill ' + (item.enabled ? 'good' : '')}>{item.enabled ? 'Enabled' : 'Disabled'}</span></td>
                <td><div className="table-actions">
                  <button type="button" aria-label={'Edit user ' + item.username}
                    onClick={() => { setError(''); setEditing(item.id) }}>Edit</button>
                  <button type="button" className="danger-button" aria-label={'Delete user ' + item.username}
                    title={protectedAccount ? 'This administrator account must stay available' : undefined}
                    disabled={deleting || protectedAccount}
                    onClick={() => void remove('users', item.id, `Delete ${item.username} and sign out all their sessions?`)}>Delete</button>
                </div></td>
              </tr>
            })}
            {!users.length && <tr><td colSpan={5} className="empty-cell">No matching users.</td></tr>}
          </tbody></table></div>
          <div className="actions"><button className="primary" type="button" onClick={() => { setError(''); setEditing('new') }}>
            <Plus size={17} aria-hidden="true" /> New user</button></div>
        </div>)}
      {data && tab === 'Panels' && (editorVisible
        ? <PanelEditor key={editing} panel={panel} refresh={revision} done={save} cancel={closeEditor} missing={missing} />
        : <div className="admin-view">
          <div className="toolbar"><SearchBox value={query} onChange={setQuery} label="Search panels" /></div>
          <div className="table-scroll"><table aria-label="Panels"><thead><tr>
            <th>Panel</th><th>Sources</th><th>Destinations</th><th>Salvos</th><th>Levels</th><th>Take Mode</th><th><span className="sr-only">Actions</span></th>
          </tr></thead><tbody>
            {panels.map(item => {
              const count = assignedUsers.get(item.id) ?? 0
              return <tr key={item.id}>
                <td>{item.name}{(!item.validLevels || [...item.sources, ...item.destinations, ...item.salvos].some(row => !row.valid)) &&
                  <small className="danger"> · Review binding</small>}</td>
                <td>{item.sources.length}</td><td>{item.destinations.length}</td><td>{item.salvos.length}</td>
                <td>{item.allLevels ? 'All' : item.levels.length}</td><td>{item.useTake ? 'Use Take' : 'Direct'}</td>
                <td><div className="table-actions">
                  <button type="button" aria-label={'Edit panel ' + item.name}
                    onClick={() => { setError(''); setEditing(item.id) }}>Edit</button>
                  <button type="button" className="danger-button" disabled={deleting} aria-label={'Delete panel ' + item.name}
                    onClick={() => void remove('panels', item.id,
                      `Delete ${item.name}? This removes the panel from ${count} assigned ${count === 1 ? 'user' : 'users'}.`)}>Delete</button>
                </div></td>
              </tr>
            })}
            {!panels.length && <tr><td colSpan={7} className="empty-cell">{data.panels.length ? 'No matching panels.' : 'No panels yet.'}</td></tr>}
          </tbody></table></div>
          <div className="actions"><button className="primary" type="button" onClick={() => { setError(''); setEditing('new') }}>
            <Plus size={17} aria-hidden="true" /> New panel</button></div>
        </div>)}
    </main>
    <AdminFooter status={status} version={data?.version} />
  </div>
}
