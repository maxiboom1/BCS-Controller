import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { CircleHelp } from 'lucide-react'
import type { ControllerSettings, RouterStatus, SettingsView } from '../shared/model.ts'
import { api } from './api.ts'
import mark from './brand-mark.svg'
import { Notice } from './components.tsx'

const fields = [
  { key: 'bcsHost', label: 'BCS IP address', help: 'The address of the Ultricore BCS that serves GVG Native.' },
  { key: 'bcsPort', label: 'GVG Native port', min: 1, max: 65535, help: 'The TCP port configured for GVG Native on BCS.' },
  { key: 'pollIntervalMs', label: 'Sync request interval (ms)', min: 1000, max: 60000, help: 'How often the app asks BCS for changed destinations. The minimum is 1000 ms.' },
  { key: 'webPort', label: 'Web server port', min: 1, max: 65535, help: 'The port browsers use to open this app. Restart the console after saving a new port.' },
  { key: 'idleMinutes', label: 'Idle logout timeout (minutes)', min: 0, max: 720, help: 'Minutes without a click, tap, or keypress before sign-out. Enter 0 to turn off idle logout. Sessions still expire after 12 hours.' },
] as const

export function SettingsTab({ status }: { status: RouterStatus }) {
  const [view, setView] = useState<SettingsView>()
  const [draft, setDraft] = useState<ControllerSettings>()
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean }>()
  useEffect(() => {
    const controller = new AbortController()
    api<SettingsView>('/admin/settings', 'GET', undefined, controller.signal).then(result => {
      setView(result)
      setDraft(result.settings)
    }).catch((error: Error) => { if (!controller.signal.aborted) setFeedback({ text: error.message, error: true }) })
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => { controller.abort(); clearInterval(interval) }
  }, [])

  const seconds = status.connectedAt ? Math.max(0, Math.floor((now - status.connectedAt) / 1000)) : 0
  const uptime = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(value => String(value).padStart(2, '0')).join(':')

  async function toggle() {
    setBusy(true)
    setFeedback(undefined)
    try { await api('/admin/router', 'PUT', { enabled: !status.enabled }) }
    catch (error) { setFeedback({ text: (error as Error).message, error: true }) }
    finally { setBusy(false) }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setFeedback(undefined)
    try {
      const result = await api<SettingsView>('/admin/settings', 'PUT', draft)
      setView(result)
      setDraft(result.settings)
      setFeedback({ text: 'Settings saved.' })
    } catch (error) { setFeedback({ text: (error as Error).message, error: true }) }
    finally { setBusy(false) }
  }

  return <div className="surface router-card">
    <div className="router-title"><img className="brand-mark" src={mark} alt="" width="57" height="32" />
      <div><h2>GVG Native</h2><p>{status.endpoint}</p></div></div>
    <dl className="metrics settings-metrics">
      <div><dt>Connection uptime</dt><dd>{uptime}</dd></div>
      {view && <><div><dt>Active web URL</dt><dd>{view.activeUrl}</dd></div>
        <div><dt>App version</dt><dd>{view.version}</dd></div></>}
    </dl>
    <button className={status.enabled ? 'danger-button' : 'primary'} type="button" aria-pressed={status.enabled}
      onClick={toggle} disabled={busy}>{status.enabled ? 'Disconnect' : 'Connect'}</button>
    {status.lastError && <Notice error>{status.lastError}</Notice>}
    {view && view.activePort !== view.settings.webPort &&
      <Notice>Port {view.settings.webPort} is saved. Restart the console to apply it.</Notice>}
    {draft && <form className="settings-form" onSubmit={save}>
      <div className="form-grid">{fields.map(field => <div className="setting-field" key={field.key}>
        <label htmlFor={field.key}>{field.label}</label>
        <details className="setting-help"><summary aria-label={'Help for ' + field.label}><CircleHelp size={16} aria-hidden="true" /></summary>
          <p>{field.help}</p></details>
        <input id={field.key} required value={draft[field.key]} disabled={busy}
          type={'min' in field ? 'number' : 'text'} min={'min' in field ? field.min : undefined} max={'max' in field ? field.max : undefined}
          onChange={event => setDraft({ ...draft, [field.key]: 'min' in field ? Number(event.currentTarget.value) : event.currentTarget.value })} />
      </div>)}</div>
      <div className="actions"><button type="submit" className="primary" disabled={busy}>Save settings</button></div>
    </form>}
    {feedback && <Notice error={feedback.error}>{feedback.text}</Notice>}
  </div>
}
