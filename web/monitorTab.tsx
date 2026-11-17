import { useEffect, useRef, useState } from 'react'
import type { MonitorPage } from '../shared/model.ts'
import { api } from './api.ts'
import { Notice, SearchBox } from './components.tsx'
import { monitorBounds, monitorRefreshDelay } from './monitorTime.ts'
import type { MonitorRange, TimeBounds } from './monitorTime.ts'

const filters = [['all', 'All time'], ['today', 'Today'], ['yesterday', 'Yesterday'], ['last', 'Last hours']] as const
const columns = ['Time', 'User', 'User IP', 'Event', 'Panel Name', 'Destination', 'Source']
const clock = new Intl.DateTimeFormat(undefined, {
  year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})
type OlderPage = { cursors: string[]; bounds: TimeBounds; head: number }
type LoadedPage = { result: MonitorPage; bounds: TimeBounds }

export function MonitorTab({ head, revision }: { head: number; revision: number }) {
  const [text, setText] = useState('')
  const [query, setQuery] = useState('')
  const [range, setRange] = useState<MonitorRange>('all')
  const [hoursInput, setHoursInput] = useState('24')
  const [older, setOlder] = useState<OlderPage>()
  const [page, setPage] = useState<LoadedPage>()
  const [error, setError] = useState('')
  const refresh = useRef<() => void>(null)
  const seen = useRef({ head, revision })
  const hours = range === 'last' ? Number(hoursInput) : 24
  const valid = Number.isInteger(hours) && hours >= 1 && hours <= 1000

  useEffect(() => {
    const needle = text.trim()
    if (needle === query) return
    const debounce = setTimeout(() => { setQuery(needle); setOlder(undefined) }, 500)
    return () => clearTimeout(debounce)
  }, [text, query])

  useEffect(() => {
    setPage(undefined)
    setError('')
    if (!valid) return

    const controller = new AbortController()
    let running = false
    let queued = false
    let timer: ReturnType<typeof setTimeout> | undefined
    async function load() {
      if (running) { queued = true; return }
      running = true
      clearTimeout(timer)
      const bounds = older?.bounds ?? monitorBounds(range, hours)
      const parameters = new URLSearchParams({ q: query })
      if (bounds.from !== undefined) parameters.set('from', String(bounds.from))
      if (bounds.to !== undefined) parameters.set('to', String(bounds.to))
      const cursor = older?.cursors.at(-1)
      if (cursor) parameters.set('before', cursor)
      try {
        const result = await api<MonitorPage>('/admin/monitor?' + parameters, 'GET', undefined, controller.signal)
        if (controller.signal.aborted) return
        setPage({ result, bounds })
        setError('')
        const delay = monitorRefreshDelay(range, hours, result.rows.at(-1)?.at)
        if (!older && delay !== undefined) timer = setTimeout(load, delay)
      } catch (err) {
        if (!controller.signal.aborted) setError((err as Error).message)
      } finally {
        running = false
        if (queued && !controller.signal.aborted) {
          queued = false
          void load()
        }
      }
    }
    refresh.current = load
    void load()
    return () => {
      refresh.current = null
      controller.abort()
      clearTimeout(timer)
    }
  }, [query, range, hours, valid, older])

  useEffect(() => {
    if (seen.current.head === head && seen.current.revision === revision) return
    seen.current = { head, revision }
    if (!older) refresh.current?.()
  }, [head, revision, older])

  function goOlder() {
    const cursor = page?.result.nextCursor
    if (page && cursor) setOlder(older ? { ...older, cursors: [...older.cursors, cursor] }
      : { cursors: [cursor], bounds: page.bounds, head: page.result.head })
  }
  function goNewer() {
    setOlder(current => current && current.cursors.length > 1 ? { ...current, cursors: current.cursors.slice(0, -1) } : undefined)
  }

  const rows = page?.result.rows ?? []
  const empty = !valid ? 'Enter 1–1000 hours.' : error ? 'History unavailable.' : page ? 'No matching activity.' : 'Loading activity…'
  return <div className="admin-view">
    <div className="toolbar monitor-toolbar">
      <SearchBox label="Search activity" value={text} onChange={setText} />
      <div className="monitor-filters" role="group" aria-label="Time range">
        {filters.map(([value, label]) => <button key={value} type="button" aria-pressed={range === value} onClick={() => {
          if (value !== range) { setRange(value); setOlder(undefined) }
        }}>{label}</button>)}
        {range === 'last' && <label className="monitor-hours">
          <input aria-label="Hours" aria-invalid={!valid} type="number" min="1" max="1000" step="1" value={hoursInput}
            onChange={event => { setHoursInput(event.target.value); setOlder(undefined) }} />
          <span className="muted">hours</span>
        </label>}
      </div>
    </div>
    {error && <Notice error>{error}</Notice>}
    <div className="table-scroll">
      <table className="monitor-table" aria-label="Monitor">
        <thead><tr>{columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead>
        <tbody>
          {rows.map(row => <tr key={row.id}>
            <td><time dateTime={new Date(row.at).toISOString()}>{clock.format(row.at)}</time></td>
            <td>{row.user}</td><td>{row.userIp ?? 'N/A'}</td><td>{row.event}</td>
            <td>{row.panelName ?? 'N/A'}</td><td>{row.destination}</td><td>{row.source}</td>
          </tr>)}
          {!rows.length && <tr><td className="empty-cell" colSpan={columns.length}>{empty}</td></tr>}
        </tbody>
      </table>
    </div>
    <div className="actions monitor-actions">
      {older && head > older.head && <span className="muted" role="status">New activity available</span>}
      <button type="button" disabled={!page?.result.nextCursor} onClick={goOlder}>Older</button>
      <button type="button" disabled={!older} onClick={goNewer}>Newer</button>
      <button type="button" disabled={!older} onClick={() => setOlder(undefined)}>Latest</button>
    </div>
  </div>
}
