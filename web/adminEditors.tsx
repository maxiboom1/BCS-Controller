import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { MIN_PASSWORD_LENGTH } from '../shared/model.ts'
import type { AdminPanelView, Binding, BoundItem, PanelView, User } from '../shared/model.ts'
import { api, ApiError } from './api.ts'
import { AssignmentPicker, reconcileAssignments } from './assignmentPicker.tsx'
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
  return <form className="admin-view editor" onSubmit={save}>
    <h2>{user ? 'Edit user' : 'New user'}</h2>
    <fieldset className="editor-fields admin-body" disabled={busy}>
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

const panelTabs = ['Panel Settings', 'Levels', 'Sources', 'Destinations', 'Salvos'] as const
type PanelTab = (typeof panelTabs)[number]

function assignmentProblem(items: BoundItem[], label: string) {
  if (!items.length) return 'Assign at least one ' + label + '.'
  if (items.some(item => !item.valid)) return 'Review ' + label + ' bindings.'
}

export function PanelEditor({ panel, refresh, done, cancel, missing }: EditorActions & { panel?: AdminPanelView; refresh: number }) {
  const [tab, setTab] = useState<PanelTab>('Panel Settings')
  const [name, setName] = useState(panel?.name ?? '')
  const [sources, setSources] = useState(panel?.sources ?? [])
  const [destinations, setDestinations] = useState(panel?.destinations ?? [])
  const [salvos, setSalvos] = useState(panel?.salvos ?? [])
  const [levels, setLevels] = useState<BoundItem[]>()
  const [useTake, setUseTake] = useState(panel?.useTake ?? true)
  const [columns, setColumns] = useState(panel?.columns ?? 6)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const sourceList = useCatalogue('sources', refresh)
  const destinationList = useCatalogue('destinations', refresh)
  const levelList = useCatalogue('levels', refresh)
  const salvoList = useCatalogue('salvos', refresh)
  const assignedSources = useMemo(() => reconcileAssignments(sources, sourceList), [sources, sourceList.items, sourceList.loading, sourceList.error])
  const assignedDestinations = useMemo(() => reconcileAssignments(destinations, destinationList),
    [destinations, destinationList.items, destinationList.loading, destinationList.error])
  const assignedLevels = reconcileAssignments(levels ?? panel?.levels ?? levelList.items.map(item => ({ ...item, valid: true })), levelList)
  const preserveAllLevels = !levels && (panel?.allLevels ?? true)
  const levelCountChanged = preserveAllLevels && panel && !levelList.loading && !levelList.error &&
    assignedLevels.length !== levelList.items.length
  const assignedSalvos = reconcileAssignments(salvos, salvoList)
  const validName = !!name.trim()
  const validColumns = Number.isInteger(columns) && columns >= 2 && columns <= 12
  const problems: Partial<Record<PanelTab, string>> = {
    'Panel Settings': !validName ? 'Enter a panel name.' : !validColumns ? 'Enter 2–12 grid columns.' : undefined,
    Sources: assignmentProblem(assignedSources, 'source'),
    Destinations: assignmentProblem(assignedDestinations, 'destination'),
    Levels: levelCountChanged ? 'Review the updated level catalogue.' : assignmentProblem(assignedLevels, 'level'),
  }
  const invalidTab = panelTabs.find(key => problems[key])
  const bindings = (rows: BoundItem[]): Binding[] => rows.map(({ id, name }) => ({ id, name }))

  async function save(event: FormEvent) {
    event.preventDefault()
    if (invalidTab) {
      setTab(invalidTab)
      setError(problems[invalidTab] ?? '')
      return
    }
    setError('')
    setBusy(true)
    try {
      await api('/admin/panels' + (panel ? '/' + panel.id : ''), panel ? 'PUT' : 'POST', {
        name, sources: bindings(sources), destinations: bindings(destinations), salvos: bindings(salvos),
        levels: preserveAllLevels ? null : bindings(assignedLevels), useTake, columns,
      })
      done()
    } catch (err) {
      if (panel && err instanceof ApiError && err.status === 404) missing(err.message)
      else setError((err as Error).message)
    } finally { setBusy(false) }
  }

  return <form className="admin-view editor" onSubmit={save}>
    <h2>{panel ? 'Edit panel' : 'New panel'}</h2>
    <fieldset className="editor-fields admin-view" disabled={busy}>
      <Tabs label="Panel editor" tabs={panelTabs} active={tab} change={setTab} problems={problems}>
        {tab === 'Panel Settings' && <div className="panel-fields admin-body">
          <div className="form-grid">
            <label>Panel name<input value={name} aria-invalid={!validName} onChange={event => setName(event.target.value)} maxLength={80} required /></label>
            <label>Grid columns<input type="number" min={2} max={12} value={Number.isNaN(columns) ? '' : columns}
              aria-invalid={!validColumns} onChange={event => setColumns(event.target.valueAsNumber)} required /></label>
          </div>
          <div className="checks">
            <label className="check"><input type="checkbox" checked={useTake} onChange={event => setUseTake(event.target.checked)} /> Use Take</label>
          </div>
        </div>}
        {tab === 'Sources' && <AssignmentPicker key={tab} kind="sources" items={assignedSources} change={setSources} listing={sourceList} />}
        {tab === 'Destinations' && <AssignmentPicker key={tab} kind="destinations" items={assignedDestinations}
          change={setDestinations} listing={destinationList} />}
        {tab === 'Levels' && <AssignmentPicker key={tab} kind="levels" items={assignedLevels}
          change={setLevels} listing={levelList} />}
        {tab === 'Salvos' && <AssignmentPicker key={tab} kind="salvos" items={assignedSalvos} change={setSalvos} listing={salvoList} />}
      </Tabs>
    </fieldset>
    {error && <Notice error>{error}</Notice>}
    <div className="actions"><button type="button" disabled={busy} onClick={cancel}>Cancel</button>
      <button className="primary" disabled={busy || !!invalidTab}>
        {busy ? 'Saving…' : 'Save panel'}</button></div>
  </form>
}
