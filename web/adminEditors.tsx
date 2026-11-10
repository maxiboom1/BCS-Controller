import { useState } from 'react'
import { MIN_PASSWORD_LENGTH } from '../shared/model.ts'
import type { FormEvent } from 'react'
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import type { Binding, BoundItem, Kind, PanelView, User } from '../shared/model.ts'
import { api } from './api.ts'
import { Notice, Pagination, SearchBox, useCatalogue } from './components.tsx'

export function UserEditor({ user, panels, done, cancel }: {
  user?: User; panels: PanelView[]; done: () => void; cancel: () => void
}) {
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
      await api('/admin/users' + (user ? '/' + user.id : ''), user ? 'PUT' : 'POST',
        { username, password: password || undefined, enabled, panelIds })
      done()
    } catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }
  return <form className="surface editor" onSubmit={save}>
    <div className="section-heading"><div><h2>{user ? 'Edit user' : 'New user'}</h2>
      <p>Manage credentials and panel access.</p></div><button className="icon-button" type="button" onClick={cancel} aria-label="Close editor"><X size={18} /></button></div>
    <div className="form-grid">
      <label>Username<input value={username} onChange={e => setUsername(e.target.value)} required minLength={2} maxLength={40} autoComplete="off" /></label>
      <label>{user ? 'New password' : 'Password'}<input type="password" value={password} onChange={e => setPassword(e.target.value)}
        required={!user} minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password"
        placeholder={user ? 'Leave blank to keep current password' : `At least ${MIN_PASSWORD_LENGTH} characters`} /></label>
    </div>
    <label className="check"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)}
      disabled={user?.role === 'admin'} /> Account enabled</label>
    <fieldset><legend>Assigned panels</legend>
      {panels.length ? <div className="checklist">{panels.map(panel => <label className="check" key={panel.id}>
        <input type="checkbox" checked={panelIds.includes(panel.id)} onChange={e => setPanelIds(ids =>
          e.target.checked ? [...ids, panel.id] : ids.filter(id => id !== panel.id))} />{panel.name}</label>)}</div>
        : <p className="muted">Create a panel to assign it here.</p>}
    </fieldset>
    {error && <Notice error>{error}</Notice>}
    <div className="actions"><button type="button" onClick={cancel}>Cancel</button>
      <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save user'}</button></div>
  </form>
}

function Picker({ kind, items, change, refresh }: {
  kind: Kind; items: BoundItem[]; change: (items: BoundItem[]) => void; refresh: number
}) {
  const listing = useCatalogue(kind, refresh)
  function move(index: number, direction: number) {
    const reordered = [...items]
    const adjacent = index + direction
    if (adjacent < 0 || adjacent >= reordered.length) return
    ;[reordered[index], reordered[adjacent]] = [reordered[adjacent], reordered[index]]
    change(reordered)
  }
  const title = kind[0].toUpperCase() + kind.slice(1)
  return <fieldset className="picker"><legend>{title} <span className="muted">· {items.length}</span></legend>
    <div className="picker-columns">
      <div className="picker-side">
        <SearchBox label={'Find ' + kind} value={listing.q} onChange={listing.setQ} />
        <div className="picker-list" aria-label={'Available ' + kind}>
          {listing.result.items.map(item => <button className="picker-row" type="button" key={item.id}
            disabled={items.some(selected => selected.id === item.id)} onClick={() => change([...items, { ...item, valid: true }])}>
            <span>{item.label}</span><Plus size={15} aria-hidden="true" />
          </button>)}
          {!listing.result.items.length && <p className="muted">{listing.loading ? 'Loading…' : 'No matching catalogue entries.'}</p>}
        </div>
        <Pagination page={listing.page} total={listing.result.total} change={listing.setPage} />
      </div>
      <div className="picker-side selected">
        <span className="muted">Selected · display order</span>
        <div className="picker-list" aria-label={'Selected ' + kind}>
          {items.map((item, i) => <div className="selected-row" key={item.id}>
            <span>{item.label}{!item.valid && <small className="danger"> · Review binding</small>}</span>
            {kind !== 'levels' && <><button className="icon-button" type="button" disabled={i === 0}
              onClick={() => move(i, -1)} aria-label={'Move ' + item.label + ' up'}><ArrowUp size={15} /></button>
              <button className="icon-button" type="button" disabled={i === items.length - 1}
                onClick={() => move(i, 1)} aria-label={'Move ' + item.label + ' down'}><ArrowDown size={15} /></button></>}
            <button className="icon-button" type="button" onClick={() => change(items.filter(row => row.id !== item.id))}
              aria-label={'Remove ' + item.label}><X size={16} /></button>
          </div>)}
          {!items.length && <p className="muted">Choose entries from the catalogue.</p>}
        </div>
      </div>
    </div>
    {listing.error && <Notice error>{listing.error}</Notice>}
  </fieldset>
}

export function PanelEditor({ panel, refresh, done, cancel }: {
  panel?: PanelView; refresh: number; done: () => void; cancel: () => void
}) {
  const [name, setName] = useState(panel?.name ?? '')
  const [sources, setSources] = useState(panel?.sources ?? [])
  const [destinations, setDestinations] = useState(panel?.destinations ?? [])
  const [levels, setLevels] = useState(panel?.allLevels ? [] : panel?.levels ?? [])
  const [all, setAll] = useState(panel?.allLevels ?? true)
  const [useTake, setUseTake] = useState(panel?.useTake ?? true)
  const [columns, setColumns] = useState(panel?.columns ?? 6)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const bindings = (rows: BoundItem[]): Binding[] => rows.map(({ id, name }) => ({ id, name }))
  async function save(event: FormEvent) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      await api('/admin/panels' + (panel ? '/' + panel.id : ''), panel ? 'PUT' : 'POST',
        { name, sources: bindings(sources), destinations: bindings(destinations), levels: all ? null : bindings(levels), useTake, columns })
      done()
    } catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }
  return <form className="surface editor" onSubmit={save}>
    <div className="section-heading"><div><h2>{panel ? 'Edit panel' : 'New panel'}</h2><p>Configure an operator’s routing grid and level scope.</p></div>
      <button className="icon-button" type="button" onClick={cancel} aria-label="Close editor"><X size={18} /></button></div>
    <div className="form-grid">
      <label>Panel name<input value={name} onChange={e => setName(e.target.value)} maxLength={80} required /></label>
      <label>Grid columns<input type="number" min={2} max={12} value={columns} onChange={e => setColumns(e.target.valueAsNumber)} required /></label>
    </div>
    <div className="checks"><label className="check"><input type="checkbox" checked={useTake}
      onChange={e => setUseTake(e.target.checked)} /> Use TAKE</label>
      <label className="check"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> All levels</label></div>
    <Picker kind="sources" items={sources} change={setSources} refresh={refresh} />
    <Picker kind="destinations" items={destinations} change={setDestinations} refresh={refresh} />
    {!all && <Picker kind="levels" items={levels} change={setLevels} refresh={refresh} />}
    {error && <Notice error>{error}</Notice>}
    <div className="actions"><button type="button" onClick={cancel}>Cancel</button><button className="primary"
      disabled={busy || !sources.length || !destinations.length || (!all && !levels.length)}>{busy ? 'Saving…' : 'Save panel'}</button></div>
  </form>
}

