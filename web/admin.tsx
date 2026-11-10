import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Clapperboard, Grid2X2, ListVideo, Monitor, Plus, Settings, Users, Video } from 'lucide-react'
import type { PanelView, RouterStatus, User } from '../shared/model.ts'
import { api } from './api.ts'
import type { CatalogueRow } from './api.ts'
import { Notice, Pagination, SearchBox, useCatalogue } from './components.tsx'
import { PanelEditor, UserEditor } from './adminEditors.tsx'
import { SettingsTab } from './settings.tsx'
import { SessionStatus } from './sessionStatus.tsx'

const tabs = [
  ['Users', Users], ['Panels', Grid2X2], ['Settings', Settings], ['Status', Monitor],
  ['Sources', Video], ['Destinations', ListVideo], ['Salvos', Clapperboard],
] as const
type Tab = typeof tabs[number][0]
type AdminData = { users: User[]; panels: PanelView[]; router: RouterStatus }

function AliasEditor({ row, kind, saved, cancel }: { row: CatalogueRow; kind: string; saved: () => void; cancel: () => void }) {
  const [alias, setAlias] = useState(row.alias)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try { await api('/admin/aliases/' + kind, 'PUT', { id: row.id, name: row.name, alias }); saved() }
    catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }
  return <form className="alias-editor" onSubmit={submit}>
    <input aria-label={'Alias for ' + row.name} value={alias} maxLength={80} onChange={e => setAlias(e.target.value)} autoFocus />
    <button className="primary" disabled={busy}>Save</button><button type="button" onClick={cancel}>Cancel</button>
    {error && <Notice error>{error}</Notice>}
  </form>
}

function AliasTable({ kind, refresh }: { kind: 'sources' | 'destinations' | 'salvos'; refresh: number }) {
  const [edit, setEdit] = useState<string>()
  const [local, setLocal] = useState(0)
  const rows = useCatalogue(kind, refresh + local)
  return <div className="surface">
    <div className="toolbar"><SearchBox value={rows.q} onChange={rows.setQ} label={'Search ' + kind} /></div>
    {rows.error && <Notice error>{rows.error}</Notice>}
    <div className="table-scroll"><table><thead><tr><th>BCS</th><th>Alias</th></tr></thead><tbody>
      {rows.result.items.map(row => <tr key={row.id}>
        <td>{row.name}</td><td>{edit === row.id
          ? <AliasEditor row={row} kind={kind} saved={() => { setEdit(undefined); setLocal(x => x + 1) }} cancel={() => setEdit(undefined)} />
          : <button className="alias-link" type="button" aria-label={'Edit alias for ' + row.name} onClick={() => setEdit(row.id)}>
            {row.alias || <span className="muted">Add alias</span>}</button>}</td>
      </tr>)}
      {!rows.result.items.length && <tr><td colSpan={2} className="empty-cell">{rows.loading ? 'Loading catalogue…' : 'No catalogue entries. Connect the router or change the search.'}</td></tr>}
    </tbody></table></div>
    <div className="toolbar"><Pagination page={rows.page} total={rows.result.total} change={rows.setPage} /></div>
  </div>
}

export function Admin({ status, revision }: { status: RouterStatus; revision: number }) {
  const [tab, setTab] = useState<Tab>('Users')
  const [data, setData] = useState<AdminData>()
  const [local, setLocal] = useState(0)
  const [editing, setEditing] = useState<string>()
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    api<AdminData>('/admin', 'GET', undefined, controller.signal).then(result => {
      setData(result)
      setError('')
    }).catch((err: Error) => { if (!controller.signal.aborted) setError(err.message) })
    return () => controller.abort()
  }, [revision, local])
  const save = () => { setEditing(undefined); setLocal(x => x + 1) }
  const needle = query.toLowerCase()
  const users = data?.users.filter(user => user.username.toLowerCase().includes(needle)) ?? []
  const panels = data?.panels.filter(panel => panel.name.toLowerCase().includes(needle)) ?? []
  return <div className="admin-layout">
    <aside className="sidebar"><span className="eyebrow">Workspace</span><nav aria-label="Admin sections">{tabs.map(([name, Icon]) =>
      <button key={name} type="button" aria-current={tab === name ? 'page' : undefined} onClick={() => {
        setTab(name); setEditing(undefined); setQuery('')
      }}><Icon size={18} aria-hidden="true" />{name}</button>)}</nav></aside>
    <main className="admin-main" id="main">
      <div className="page-heading"><span className="eyebrow">Administration</span><h1>{tab}</h1>
        <p>{{ Users: 'Manage operator accounts and panel access.', Panels: 'Build routing grids for each operator workflow.',
          Settings: 'Manage the BCS connection and web server.', Status: 'Monitor online client sessions.',
          Sources: 'Set operator-facing source names.',
          Destinations: 'Set operator-facing destination names.', Salvos: 'Manage display names for BCS salvos.' }[tab]}</p></div>
      {error && <Notice error>{error}</Notice>}
      {tab === 'Settings' && <SettingsTab status={status} />}
      {tab === 'Status' && <SessionStatus />}
      {(tab === 'Sources' || tab === 'Destinations' || tab === 'Salvos') &&
        <AliasTable key={tab} kind={tab.toLowerCase() as 'sources' | 'destinations' | 'salvos'} refresh={revision} />}
      {data && tab === 'Users' && <>
        {editing && <UserEditor key={editing} user={data.users.find(user => user.id === editing)} panels={data.panels} done={save} cancel={() => setEditing(undefined)} />}
        <div className="surface"><div className="toolbar"><SearchBox value={query} onChange={setQuery} label="Search users" />
          <button className="primary" type="button" onClick={() => setEditing('new')}><Plus size={17} /> New user</button></div>
          <div className="table-scroll"><table><thead><tr><th>Username</th><th>Role</th><th>Panels</th><th>Account</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{users.map(user => <tr key={user.id}>
              <td className="strong">{user.username}</td><td className="capitalize">{user.role}</td><td>{user.panelIds.length}</td>
              <td><span className={'pill ' + (user.enabled ? 'good' : '')}>{user.enabled ? 'Enabled' : 'Disabled'}</span></td>
              <td><button type="button" onClick={() => setEditing(user.id)} aria-label={'Edit user ' + user.username}>Edit</button></td></tr>)}
              {!users.length && <tr><td colSpan={5} className="empty-cell">No matching users.</td></tr>}</tbody></table></div></div>
      </>}
      {data && tab === 'Panels' && <>
        {editing && <PanelEditor key={editing} panel={data.panels.find(panel => panel.id === editing)} refresh={revision} done={save} cancel={() => setEditing(undefined)} />}
        <div className="surface"><div className="toolbar"><SearchBox value={query} onChange={setQuery} label="Search panels" />
          <button className="primary" type="button" onClick={() => setEditing('new')}><Plus size={17} /> New panel</button></div>
          <div className="table-scroll"><table><thead><tr><th>Panel</th><th>Sources</th><th>Destinations</th><th>Levels</th><th>Mode</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{panels.map(panel => <tr key={panel.id}>
              <td className="strong">{panel.name}{(!panel.validLevels || [...panel.sources, ...panel.destinations].some(row => !row.valid)) &&
                <small className="danger"> · Review binding</small>}</td>
              <td>{panel.sources.length}</td><td>{panel.destinations.length}</td><td>{panel.allLevels ? 'All' : panel.levels.length}</td>
              <td>{panel.useTake ? 'Staged TAKE' : 'Immediate'}</td><td><button type="button" aria-label={'Edit panel ' + panel.name}
                onClick={() => setEditing(panel.id)}>Edit</button></td></tr>)}
              {!panels.length && <tr><td colSpan={6} className="empty-cell">{data.panels.length
                ? 'No matching panels.' : 'No panels yet. Connect the router to populate the catalogues, then create a panel.'}</td></tr>}
            </tbody></table></div></div>
      </>}
    </main>
  </div>
}

