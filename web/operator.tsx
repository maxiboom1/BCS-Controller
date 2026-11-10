import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { BoundItem, PanelView, Route, RouterStatus, Snapshot, TakeResult } from '../shared/model.ts'
import { api } from './api.ts'
import { StatusBadge } from './components.tsx'
import { DestinationGrid } from './destinationGrid.tsx'

type UpdateRoute = (route: Route, previous?: string) => void
type Staged = { source: BoundItem; revision: string }
type Feedback = { message: string; error?: boolean; success?: boolean }
type OperatorContext = { state: Snapshot; status: RouterStatus; error: string; update: UpdateRoute }

export function Operator({ panel, ...context }: OperatorContext & { panel?: PanelView }) {
  return <main id="main" className="operator">
    {panel ? <RoutingPanel key={panel.id + ':' + panel.version} panel={panel} {...context} />
      : <><p className="empty-operator">No panels assigned.</p>
        <OperatorStatus status={context.status} feedback={context.error ? { message: context.error, error: true } : undefined} /></>}
  </main>
}

function OperatorStatus({ status, destination, summary, warning, feedback }: {
  status: RouterStatus; destination?: string; summary?: string; warning?: boolean; feedback?: Feedback
}) {
  const readback = destination && `${destination} · ${summary}`
  return <footer className="operator-status" aria-label="Routing status">
    <div className={'status-readback' + (warning ? ' danger' : '')} role="status" title={readback}>
      {destination && <><strong>{destination}</strong> · {summary}</>}
    </div>
    <div className={'status-feedback' + (feedback?.error ? ' danger' : feedback?.success ? ' success' : '')}
      role="status" title={feedback?.message}>{feedback?.message}</div>
    <div className="status-connection" role="status">
      {status.mode === 'simulator' && <span className="mode-label">Simulator</span>}
      <StatusBadge status={status} />
    </div>
  </footer>
}

function RoutingPanel({ panel, state, status, error, update }: OperatorContext & { panel: PanelView }) {
  const [destinationId, setDestinationId] = useState('')
  const [staged, setStaged] = useState<Staged>()
  const [fresh, setFresh] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>()
  const destination = panel.destinations.find(item => item.id === destinationId)
  const online = status.state === 'live'
  const routes = useMemo(() => new Map(online ? state.routes.map(route => [route.destinationId, route]) : []), [online, state.routes])
  const route = routes.get(destinationId)
  const readKey = online && destination?.valid ? destinationId + ':' + status.connectedAt + ':' + refresh : ''
  useEffect(() => {
    if (!readKey) { setFresh(''); setStaged(undefined); return }
    const controller = new AbortController()
    setFresh('')
    setStaged(undefined)
    setFeedback(undefined)
    api<Route>('/panels/' + panel.id + '/destinations/' + destinationId, 'GET', undefined, controller.signal)
      .then(value => {
        if (!controller.signal.aborted) {
          update(value, route?.revision)
          setFresh(readKey)
        }
      }).catch((error: Error) => {
        if (!controller.signal.aborted) setFeedback({ message: error.message, error: true })
      })
    return () => controller.abort()
    // Delta events update the existing view without requesting another targeted read.
  }, [readKey, panel.id, destinationId, update])

  const points = panel.levels.map(level => route?.levels[level.id])
  const sources = new Set(points.flatMap(point => point?.sourceId ? [point.sourceId] : []))
  const resolved = panel.validLevels && points.every(point => !!point?.sourceId)
  const chopping = points.some(point => point?.chopping)
  const sourceId = resolved && sources.size === 1 && !chopping ? [...sources][0] : undefined
  const inPanel = panel.sources.find(source => source.id === sourceId && source.valid)
  const hasFresh = !!readKey && fresh === readKey
  const confirmed = hasFresh ? inPanel?.id : undefined
  const stageChanged = !!staged && staged.revision !== route?.revision
  const protectedLevels = chopping || points.some(point => point?.protected)
  const canRoute = Boolean(hasFresh && route && resolved && !protectedLevels &&
    status.writes && (panel.allLevels || status.selectedLevels) && !busy)
  const readbackWarning = !online || !destination?.valid || !panel.validLevels ||
    (hasFresh ? !resolved && sources.size <= 1 && !chopping : feedback?.error)

  let summary = 'Offline or stale'
  if (online && destination) {
    if (!destination.valid || !panel.validLevels) summary = 'Catalogue binding requires review'
    else if (!hasFresh) summary = feedback?.error ? 'Status unavailable' : 'Reading destination…'
    else if (sources.size > 1 || chopping) summary = 'Mixed'
    else if (!resolved) summary = 'No crosspoint on one or more levels'
    else if (!inPanel) summary = 'Routed from ' + (route?.sourceLabels[sourceId ?? ''] ?? sourceId ?? 'Unknown') + ' · outside panel'
    else summary = 'Routed from ' + inPanel.label
  }

  let action = feedback
  if (error) action = { message: error, error: true }
  else if (busy) action = { message: 'Verifying TAKE…' }
  else if (stageChanged) action = { message: 'Routing changed. Select a source again.', error: true }
  else if (!action && hasFresh && protectedLevels) action = { message: 'Panel levels are protected or chopping.', error: true }
  else if (!action && hasFresh && !status.writes) action = { message: 'Read-only router', error: true }
  else if (!action && hasFresh && !panel.allLevels && !status.selectedLevels) action = { message: 'Selected-level routing is disabled.', error: true }
  else if (!action && staged) action = { message: 'Staged · ' + staged.source.label }

  async function take(source: BoundItem, revision: string) {
    if (!canRoute || !source.valid || !destination?.valid) return
    setBusy(true)
    setStaged(undefined)
    setFeedback(undefined)
    try {
      const result = await api<TakeResult>('/panels/' + panel.id + '/takes', 'POST', {
        actionId: crypto.randomUUID(), sourceId: source.id, destinationId, revision, panelVersion: panel.version,
      })
      if (result.route) update(result.route, revision)
      if (result.outcome === 'uncertain') setFresh('')
      setFeedback(result.outcome === 'confirmed' ? { message: 'TAKE confirmed', success: true } : { message: result.message, error: true })
    } catch {
      setFresh('')
      setFeedback({ message: 'TAKE request could not be confirmed. Check the destination before retrying.', error: true })
    } finally { setBusy(false) }
  }

  function selectSource(source: BoundItem) {
    if (!canRoute || !route) return
    setFeedback(undefined)
    if (panel.useTake) setStaged({ source, revision: route.revision })
    else void take(source, route.revision)
  }

  function selectDestination(id: string) {
    if (id === destinationId) setRefresh(value => value + 1)
    else setDestinationId(id)
    setFeedback(undefined)
  }

  const style = { '--columns': panel.columns } as CSSProperties
  return <div className="routing-panel">
    <section className="surface grid-section" aria-labelledby="sources-heading">
      <h2 id="sources-heading" className="grid-heading">Sources</h2>
      <div className="route-grid" style={style}>{panel.sources.map(source => {
        const routed = source.id === confirmed
        const pending = !stageChanged && staged?.source.id === source.id
        return <button type="button" key={source.id} className={'route-key' + (routed ? ' routed' : '') + (pending ? ' staged' : '')}
          title={source.label} aria-pressed={panel.useTake ? pending : undefined}
          aria-description={!source.valid ? 'Catalogue binding requires review' : routed ? 'Routed source' : undefined}
          disabled={!source.valid || !canRoute} onClick={() => selectSource(source)}><span>{source.label}</span></button>
      })}</div>
    </section>
    <DestinationGrid items={panel.destinations} routes={routes} levels={state.levels ?? []} selection={destinationId} busy={busy}
      style={style} select={selectDestination} />
    {panel.useTake && <div className="take-row">
      <button className="take-button" type="button" disabled={!canRoute || !staged || stageChanged}
        onClick={() => { if (staged) void take(staged.source, staged.revision) }}>TAKE</button>
    </div>}
    <OperatorStatus status={status} destination={destination?.label} summary={summary} warning={!!destination && readbackWarning} feedback={action} />
  </div>
}
