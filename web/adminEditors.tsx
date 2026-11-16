import { useState } from 'react'
import type { FormEvent } from 'react'
import { MIN_PASSWORD_LENGTH } from '../shared/model.ts'
import type { AdminPanelView, Binding, BoundItem, PanelView, User } from '../shared/model.ts'
import { api, ApiError } from './api.ts'
import { AssignmentPicker } from './assignmentPicker.tsx'
import { Notice, Tabs, useCatalogue } from './components.tsx'

type EditorActions = { done: () => void; cancel: () => void; missing: (message: string) => void }

export function UserEditor({ user, panels, done, cancel, missing }: EditorActions & { user?: User; panels: PanelView[] }) {
  const [username, setUsername] = useState(user?.username ?? '')
  const [password, setPassword] = useState('')
  const [enabled, setEnabled] = useState(user?.enabled ?? true)
  const [panelIds, setPanelIds] = useState(user?.panelIds ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api('/admin/users' + (user ? '/' + user.id : ''), user ? 'PUT' : 'POST', {
        username, password: password || undefined, enabled, panelIds: panelIds.filter(id => panels.some(panel => panel.id === id)),
      })
      done()
    } catch (err) {
      if (user && err instanceof ApiError && err.status === 404) missing(err.message)
      else setError((err as Error).message)
    } finally { setBusy(false) }
  }
  return <form className="surface editor" onSubmit={save}>
    <h2>{user ? 'Edit user' : 'New user'}</h2>
    <fieldset className="editor-fields" disabled={busy}>
      <div className="form-grid">
        <label>Username<input value={username} onChange={event => setUsername(event.target.value)}
          required minLength={2} maxLength={40} autoComplete="off" /></label>
        <label>{user ? 'New password' : 'Password'}<input type="password" value={password}
          onChange={event => setPassword(event.target.value)} required={!user} minLength={MIN_PASSWORD_LENGTH}
          autoComplete="new-password" placeholder={user ? 'Leave blank to keep current password' : undefined} /></label>
      </div>
      <label className="check"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)}
        disabled={user?.role === 'admin'} /> Account enabled</label>
      <fieldset><legend>Assigned panels</legend>
        {panels.length ? <div className="checklist">{panels.map(panel => <label className="check" key={panel.id}>
          <input type="checkbox" checked={panelIds.includes(panel.id)} onChange={event => {
            const checked = event.target.checked
            setPanelIds(ids => checked ? [...ids, panel.id] : ids.filter(id => id !== panel.id))
          }} />{panel.name}</label>)}</div> : <p className="muted">No panels available.</p>}
      </fieldset>
    </fieldset>
    {error && <Notice error>{error}</Notice>}
    <div className="actions"><button type="button" disabled={busy} onClick={cancel}>Cancel</button>
      <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save user'}</button></div>
  </form>
}

function PanelLevels({ items, change, refresh }: { items: BoundItem[]; change: (items: BoundItem[]) => void; refresh: number }) {
  const listing = useCatalogue('levels', refresh)
  const current = new Map(listing.items.map(row => [row.id, row]))
  const unavailable = items.filter(row => current.get(row.id)?.name !== row.name)
  return <fieldset><legend>Levels</legend>
    {listing.error && <Notice error>{listing.error}</Notice>}
    <div className="checklist">
      {listing.items.map(item => <label key={item.id} className="check">
        <input type="checkbox" checked={items.some(row => row.id === item.id && row.name === item.name)} onChange={event => {
          const remaining = items.filter(row => row.id !== item.id)
          change(event.target.checked ? [...remaining, { ...item, valid: true }] : remaining)
        }} />{item.label}</label>)}
      {!listing.loading && unavailable.map(item => <label key={'missing-' + item.id} className="check danger">
        <input type="checkbox" checked onChange={() => change(items.filter(row => row.id !== item.id))} />
        {item.label} · Review binding</label>)}
    </div>
    {!listing.items.length && !listing.error && <p className="muted">{listing.loading ? 'Loading levels…' : 'No levels available.'}</p>}
  </fieldset>
}

const panelTabs = ['Panel Settings', 'Sources', 'Destinations', 'Salvos'] as const

export function PanelEditor({ panel, refresh, done, cancel, missing }: EditorActions & { panel?: AdminPanelView; refresh: number }) {
  const [tab, setTab] = useState<(typeof panelTabs)[number]>('Panel Settings')
  const [name, setName] = useState(panel?.name ?? '')
  const [sources, setSources] = useState(panel?.sources ?? [])
  const [destinations, setDestinations] = useState(panel?.destinations ?? [])
  const [salvos, setSalvos] = useState(panel?.salvos ?? [])
  const [levels, setLevels] = useState(panel?.allLevels ? [] : panel?.levels ?? [])
  const [all, setAll] = useState(panel?.allLevels ?? true)
  const [useTake, setUseTake] = useState(panel?.useTake ?? true)
  const [columns, setColumns] = useState(panel?.columns ?? 6)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const bindings = (rows: BoundItem[]): Binding[] => rows.map(({ id, name }) => ({ id, name }))

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!name.trim() || !Number.isInteger(columns) || columns < 2 || columns > 12) {
      setTab('Panel Settings')
      setError('Enter a panel name and 2–12 grid columns.')
      return
    }
    setError('')
    setBusy(true)
    try {
      await api('/admin/panels' + (panel ? '/' + panel.id : ''), panel ? 'PUT' : 'POST', {
        name, sources: bindings(sources), destinations: bindings(destinations), salvos: bindings(salvos),
        levels: all ? null : bindings(levels), useTake, columns,
      })
      done()
    } catch (err) {
      if (panel && err instanceof ApiError && err.status === 404) missing(err.message)
      else setError((err as Error).message)
    } finally { setBusy(false) }
  }

  return <form className="surface editor" onSubmit={save}>
    <h2>{panel ? 'Edit panel' : 'New panel'}</h2>
    <fieldset className="editor-fields" disabled={busy}>
      <Tabs label="Panel editor" tabs={panelTabs} active={tab} change={setTab}>
        {tab === 'Panel Settings' && <div className="panel-fields">
          <div className="form-grid">
            <label>Panel name<input value={name} onChange={event => setName(event.target.value)} maxLength={80} required /></label>
            <label>Grid columns<input type="number" min={2} max={12} value={Number.isNaN(columns) ? '' : columns}
              onChange={event => setColumns(event.target.valueAsNumber)} required /></label>
          </div>
          <div className="checks">
            <label className="check"><input type="checkbox" checked={useTake} onChange={event => setUseTake(event.target.checked)} /> Use TAKE</label>
            <label className="check"><input type="checkbox" checked={all} onChange={event => setAll(event.target.checked)} /> All levels</label>
          </div>
          {!all && <PanelLevels items={levels} change={setLevels} refresh={refresh} />}
        </div>}
        {tab === 'Sources' && <AssignmentPicker key={tab} kind="sources" items={sources} change={setSources} refresh={refresh} />}
        {tab === 'Destinations' && <AssignmentPicker key={tab} kind="destinations" items={destinations} change={setDestinations} refresh={refresh} />}
        {tab === 'Salvos' && <AssignmentPicker key={tab} kind="salvos" items={salvos} change={setSalvos} refresh={refresh} />}
      </Tabs>
    </fieldset>
    {error && <Notice error>{error}</Notice>}
    <div className="actions"><button type="button" disabled={busy} onClick={cancel}>Cancel</button>
      <button className="primary" disabled={busy || !sources.length || !destinations.length || (!all && !levels.length)}>
        {busy ? 'Saving…' : 'Save panel'}</button></div>
  </form>
}
