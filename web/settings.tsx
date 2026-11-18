import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { CircleHelp } from 'lucide-react'
import type { ControllerSettings, FullSyncResult, SettingsView } from '../shared/model.ts'
import { describeSyncChanges } from '../shared/syncSummary.ts'
import { api } from './api.ts'
import { Notice, Tabs } from './components.tsx'
import { ProtocolConsole } from './protocolConsole.tsx'

const tabs = ['Ultrix Communication', 'Web Settings', 'Console'] as const
type SettingsSection = (typeof tabs)[number]
const communication = [
  { key: 'bcsHost', label: 'BCS IP address', help: 'The address of the Ultricore BCS that serves GVG Native.' },
  { key: 'bcsPort', label: 'GVG Native port', min: 1, max: 65535, help: 'The TCP port configured for GVG Native on BCS.' },
  { key: 'pollIntervalMs', label: 'Sync request interval (ms)', min: 1000, max: 60000, help: 'How often the app asks BCS for changed destinations. The minimum is 1000 ms.' },
  { key: 'catalogueCheckMinutes', label: 'Full sync interval (minutes)', min: 30, help: 'How often the app reloads the catalogues and full crosspoint status on the active BCS connection. Defaults to 30 minutes.' },
] as const
const web = [
  { key: 'webPort', label: 'Web server port', min: 1, max: 65535, help: 'The port browsers use to open this app. Restart the console after saving a new port.' },
  { key: 'idleMinutes', label: 'Idle logout timeout (minutes)', min: 0, max: 720, help: 'Minutes without a click, tap, or keypress before sign-out. Enter 0 to turn off idle logout. Sessions still expire after 12 hours.' },
] as const

export function SettingsTab() {
  const [tab, setTab] = useState<SettingsSection>('Ultrix Communication')
  const [view, setView] = useState<SettingsView>()
  const [draft, setDraft] = useState<ControllerSettings>()
  const [busy, setBusy] = useState<'save' | 'sync'>()
  const [monitoring, setMonitoring] = useState(false)
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean }>()
  useEffect(() => {
    const controller = new AbortController()
    api<SettingsView>('/admin/settings', 'GET', undefined, controller.signal).then(result => {
      setView(result)
      setDraft(result.settings)
    }).catch((error: Error) => { if (!controller.signal.aborted) setFeedback({ text: error.message, error: true }) })
    return () => controller.abort()
  }, [])

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft || busy) return
    const invalid = [...communication, ...web].find(field => {
      if (!('min' in field)) return !draft.bcsHost.trim()
      const value = draft[field.key]
      return !Number.isInteger(value) || value < field.min || ('max' in field && value > field.max)
    })
    if (invalid) {
      setTab(web.some(field => field.key === invalid.key) ? 'Web Settings' : 'Ultrix Communication')
      setFeedback({ text: 'Check the value for ' + invalid.label + '.', error: true })
      return
    }
    setBusy('save')
    setFeedback(undefined)
    try {
      const result = await api<SettingsView>('/admin/settings', 'PUT', draft)
      setView(result)
      setDraft(result.settings)
      setFeedback({ text: 'Settings saved.' })
    } catch (error) { setFeedback({ text: (error as Error).message, error: true }) }
    finally { setBusy(undefined) }
  }

  async function syncNow() {
    const started = performance.now()
    setBusy('sync')
    setFeedback(undefined)
    try {
      const result = await api<FullSyncResult>('/admin/catalogue/refresh', 'POST')
      const elapsed = Math.round(performance.now() - started)
      setFeedback({ text: `Sync complete in ${elapsed} ms · routing pause ${result.syncMs} ms · ${describeSyncChanges(result)}` })
    } catch (error) {
      setFeedback({ text: (error as Error).message, error: true })
    } finally { setBusy(undefined) }
  }

  const fields = tab === 'Web Settings' ? web : communication
  return <form className="admin-view" onSubmit={save}>
    <Tabs label="Settings" tabs={tabs} active={tab} change={section => {
      setTab(section)
      if (section === 'Console') setMonitoring(true)
    }}>
      {tab !== 'Console' && <div className="admin-body settings-fields">
        {draft && <div className="form-grid">{fields.map(field => <div className="setting-field" key={field.key}>
        <label htmlFor={field.key}>{field.label}</label>
        <details className="setting-help"><summary aria-label={'Help for ' + field.label}><CircleHelp size={16} aria-hidden="true" /></summary>
          <p>{field.help}</p></details>
        <div className="setting-value">
          <input id={field.key} required value={Number.isNaN(draft[field.key]) ? '' : draft[field.key]} disabled={busy === 'save'}
            type={'min' in field ? 'number' : 'text'} min={'min' in field ? field.min : undefined} max={'max' in field ? field.max : undefined}
            onChange={event => setDraft({ ...draft, [field.key]: 'min' in field ? event.currentTarget.valueAsNumber : event.currentTarget.value })} />
          {field.key === 'catalogueCheckMinutes' && <button type="button" disabled={!!busy} onClick={() => void syncNow()}>
            {busy === 'sync' ? 'Syncing…' : 'Sync Now'}
          </button>}
        </div>
        </div>)}</div>}
        {tab === 'Web Settings' && view && view.activePort !== view.settings.webPort &&
          <Notice>Port {view.settings.webPort} is saved. Restart the console to apply it.</Notice>}
      </div>}
      {monitoring && <ProtocolConsole visible={tab === 'Console'} />}
    </Tabs>
    {feedback && <Notice error={feedback.error}>{feedback.text}</Notice>}
    <div className="actions">
      {draft && <button type="submit" className="primary" disabled={!!busy}>{busy === 'save' ? 'Saving…' : 'Save'}</button>}
    </div>
  </form>
}
