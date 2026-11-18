import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { BoundItem, PanelView, Route, RouterStatus, Snapshot, TakeResult } from '../shared/model.ts'
import { api, newActionId } from './api.ts'
import { StatusBadge } from './components.tsx'
import { DestinationGrid } from './destinationGrid.tsx'
import { videoSourceId } from './routeLevels.ts'

type UpdateRoute = (route: Route, previous: string | undefined, syncGeneration: number) => void
type Staged = { source: BoundItem; revision: string }
type Feedback = { message: string; error?: boolean; success?: boolean; uncertain?: boolean }
type OperatorContext = { state: Snapshot; status: RouterStatus; error: string; update: UpdateRoute }

export function Operator({ panel, ...context }: OperatorContext & { panel?: PanelView }) {
  const [holds, setHolds] = useState(new Map<string, number>())
  const [taking, setTaking] = useState(false)

  function setVerification(id: string, syncGeneration: number, required: boolean) {
    setHolds(previous => {
      const next = new Map(previous)
      if (required && (next.get(id) ?? 0) <= syncGeneration) next.set(id, syncGeneration)
      else if (!required && next.get(id) === syncGeneration) next.delete(id)
      return next
    })
  }

  return <main id="main" className="operator">
    {panel ? <RoutingPanel key={panel.id + ':' + panel.version} panel={panel} holds={holds}
      setVerification={setVerification} taking={taking} setTaking={setTaking} {...context} />
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

function RoutingPanel({ panel, state, status, error, update, holds, setVerification, taking, setTaking }: OperatorContext & {
  panel: PanelView; holds: ReadonlyMap<string, number>
  setVerification: (id: string, syncGeneration: number, required: boolean) => void
  taking: boolean; setTaking: (taking: boolean) => void
}) {
  const [destinationId, setDestinationId] = useState('')
  const [staged, setStaged] = useState<Staged>()
  const [checking, setChecking] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>()
  const verification = useRef<AbortController>(null)
  const destination = panel.destinations.find(item => item.id === destinationId)
  const syncGeneration = status.state === 'live' ? status.syncGeneration : null
  const online = syncGeneration !== null
  const needsVerification = online && holds.get(destinationId) === syncGeneration
  const routes = useMemo(() => {
    const available = syncGeneration === null ? [] : state.routes.filter(route => holds.get(route.destinationId) !== syncGeneration)
    return new Map(available.map(route => [route.destinationId, route]))
  }, [syncGeneration, holds, state.routes])
  const route = routes.get(destinationId)
  useEffect(() => { setStaged(undefined) }, [syncGeneration])
  useEffect(() => () => verification.current?.abort(), [])

  const points = panel.levels.map(level => route?.levels[level.id])
  const sources = new Set(points.flatMap(point => point?.sourceId ? [point.sourceId] : []))
  const resolved = panel.validLevels && points.every(point => !!point?.sourceId)
  const chopping = points.some(point => point?.chopping)
  const sourceId = resolved && sources.size === 1 && !chopping ? [...sources][0] : undefined
  const inPanel = panel.sources.find(source => source.id === sourceId && source.valid)
  const hasStatus = Boolean(destination?.valid && route)
  const confirmedVideo = hasStatus && route ? videoSourceId(state.levels ?? [], route) : undefined
  const stageChanged = !!staged && staged.revision !== route?.revision
  const protectedLevels = chopping || points.some(point => point?.protected)
  const canRoute = Boolean(hasStatus && resolved && !protectedLevels &&
    status.writes && !taking && !checking)
  const readbackWarning = !hasStatus || !panel.validLevels || (!resolved && sources.size <= 1 && !chopping)

  let summary = status.state === 'syncing' ? 'Synchronizing' : 'Offline or stale'
  if (online && destination) {
    if (!destination.valid || !panel.validLevels) summary = 'Catalogue binding requires review'
    else if (checking) summary = 'Verifying destination…'
    else if (needsVerification) summary = 'Verification required'
    else if (!hasStatus) summary = 'Status unavailable'
    else if (sources.size > 1 || chopping) summary = 'Mixed'
    else if (!resolved) summary = 'No crosspoint on one or more levels'
    else if (!inPanel) summary = 'Routed from ' + (route?.sourceLabels[sourceId ?? ''] ?? sourceId ?? 'Unknown') + ' · outside panel'
    else summary = 'Routed from ' + inPanel.label
  }

  let action = feedback?.uncertain && online && !needsVerification ? undefined : feedback
  if (error) action = { message: error, error: true }
  else if (taking) action = { message: 'Verifying TAKE…' }
  else if (stageChanged) action = { message: 'Routing changed. Select a source again.', error: true }
  else if (!action && !checking && needsVerification) action = { message: 'Select the destination again to verify routing.', error: true }
  else if (!action && hasStatus && protectedLevels) action = { message: 'Panel levels are protected or chopping.', error: true }
  else if (!action && hasStatus && !status.writes) action = { message: 'Read-only router', error: true }
  else if (!action && staged) action = { message: 'Staged · ' + staged.source.label }

  async function take(source: BoundItem, revision: string) {
    if (!canRoute || !source.valid || !destination?.valid || syncGeneration === null) return
    setTaking(true)
    setStaged(undefined)
    setFeedback(undefined)
    try {
      const result = await api<TakeResult>('/panels/' + panel.id + '/takes', 'POST', {
        actionId: newActionId(), sourceId: source.id, destinationId, revision, panelVersion: panel.version,
      })
      if (result.route) update(result.route, revision, syncGeneration)
      if (result.outcome === 'uncertain') setVerification(destinationId, syncGeneration, true)
      setFeedback(result.outcome === 'confirmed' ? { message: 'TAKE confirmed', success: true }
        : { message: result.message, error: true, uncertain: result.outcome === 'uncertain' })
    } catch {
      setVerification(destinationId, syncGeneration, true)
      setFeedback({ message: 'TAKE request could not be confirmed. Check the destination before retrying.', error: true, uncertain: true })
    } finally { setTaking(false) }
  }

  function selectSource(source: BoundItem) {
    if (!canRoute || !route) return
    setFeedback(undefined)
    if (panel.useTake) setStaged({ source, revision: route.revision })
    else void take(source, route.revision)
  }

  async function selectDestination(id: string) {
    setDestinationId(id)
    setStaged(undefined)
    setFeedback(undefined)
    if (syncGeneration === null || holds.get(id) !== syncGeneration || !panel.destinations.some(item => item.id === id && item.valid)) return

    const controller = new AbortController()
    verification.current = controller
    const previous = state.routes.find(item => item.destinationId === id)?.revision
    setChecking(true)
    try {
      const checked = await api<Route>('/panels/' + panel.id + '/destinations/' + id, 'GET', undefined, controller.signal)
      if (controller.signal.aborted) return
      update(checked, previous, syncGeneration)
      setVerification(id, syncGeneration, false)
    } catch (err) {
      if (!controller.signal.aborted) setFeedback({ message: (err as Error).message, error: true })
    } finally {
      verification.current = null
      if (!controller.signal.aborted) setChecking(false)
    }
  }

  const style = { '--columns': panel.columns } as CSSProperties
  return <div className="routing-panel">
    <section className="surface grid-section" aria-labelledby="sources-heading">
      <h2 id="sources-heading" className="grid-heading">Sources</h2>
      <div className="route-grid" style={style}>{panel.sources.map(source => {
        const routed = source.valid && source.id === confirmedVideo
        const pending = !stageChanged && staged?.source.id === source.id
        return <button type="button" key={source.id} className={'route-key' + (routed ? ' routed' : '') + (pending ? ' staged' : '')}
          title={source.label} aria-pressed={panel.useTake ? pending : undefined}
          aria-description={!source.valid ? 'Catalogue binding requires review' : routed ? 'Routed video source' : undefined}
          disabled={!source.valid || !canRoute} onClick={() => selectSource(source)}><span>{source.label}</span></button>
      })}</div>
    </section>
    <DestinationGrid items={panel.destinations} routes={routes} levels={state.levels ?? []} selection={destinationId} busy={taking || checking}
      style={style} select={id => void selectDestination(id)} />
    {panel.useTake && <div className="take-row">
      <button className="take-button" type="button" disabled={!canRoute || !staged || stageChanged}
        onClick={() => { if (staged) void take(staged.source, staged.revision) }}>TAKE</button>
    </div>}
    <OperatorStatus status={status} destination={destination?.label} summary={summary} warning={!!destination && readbackWarning} feedback={action} />
  </div>
}
