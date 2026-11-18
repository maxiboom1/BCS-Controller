import { setTimeout as wait } from 'node:timers/promises'
import { emptyCatalogue } from '../shared/model.ts'
import type { Catalogue, ControllerSettings, Crosspoints, FullSyncResult, RouterStatus } from '../shared/model.ts'
import { findCatalogueRenames } from './catalogueRenames.ts'
import { Gvg } from './gvg.ts'
import type { PacketObserver } from './gvg.ts'
import { reconcileSnapshot, routeRecord, sourceChanges } from './routeCache.ts'
import type { StatusRecord } from './routeCache.ts'
import { DEFAULT_SETTINGS, endpointAddress } from './settings.ts'

export type Endpoint = { host: string; port: number; mode: RouterStatus['mode'] }
type Change = { destinationId?: string; catalogue?: boolean; syncRouteIds?: ReadonlySet<string> }
type RouterSettings = Pick<ControllerSettings, 'bcsHost' | 'bcsPort' | 'pollIntervalMs' | 'catalogueCheckMinutes'>
export type TakeObservation = {
  actionKey: string; username: string; ip: string | null; panelName: string; sourceId: string; levelIds: ReadonlySet<string>
}
export type RouteObservation = {
  at: number; destinationId: string; levels: { id: string; sourceId: string | null; chopping: boolean }[]; take?: TakeObservation
}
export type Link = { gvg: Gvg; read: (id: string, take?: TakeObservation) => Promise<StatusRecord>; ensure: () => void }

const RECONNECT_DELAY_MS = 5000
type SyncOrigin = { trigger: 'manual' | 'scheduled'; username?: string }

export class Router {
  catalogue: Catalogue = emptyCatalogue()
  routes = new Map<string, StatusRecord>()
  status: RouterStatus
  changed = (_change: Change) => {}
  observeSync?: (result: FullSyncResult, origin: SyncOrigin) => void
  observeRoutes?: (observations: RouteObservation[]) => void
  observePacket?: PacketObserver
  private endpoint: Endpoint
  private controller: AbortController | null = null
  private connection: Gvg | null = null
  private tail: Promise<unknown> = Promise.resolve()
  private runner: Promise<void> = Promise.resolve()
  private reconfiguring = false
  private pollIntervalMs: number
  private fullSyncMinutes: number
  private syncFinishedAt = 0
  private syncRequest?: Promise<FullSyncResult>

  constructor(endpoint: Endpoint, storedCatalogue?: Catalogue, pollIntervalMs = DEFAULT_SETTINGS.pollIntervalMs,
    fullSyncMinutes = DEFAULT_SETTINGS.catalogueCheckMinutes) {
    this.endpoint = endpoint
    this.pollIntervalMs = pollIntervalMs
    this.fullSyncMinutes = fullSyncMinutes
    if (storedCatalogue) this.catalogue = storedCatalogue
    this.status = {
      state: 'offline', enabled: false, connectedAt: null, syncGeneration: 0, lastError: null,
      mode: endpoint.mode, endpoint: endpoint.mode === 'simulator' ? 'Local GVG simulator' : endpointAddress(endpoint.host, endpoint.port),
      writes: endpoint.mode !== 'live-readonly',
    }
  }

  async configure(settings: RouterSettings, storedCatalogue?: Catalogue) {
    this.pollIntervalMs = settings.pollIntervalMs
    this.fullSyncMinutes = settings.catalogueCheckMinutes
    if (this.endpoint.mode === 'simulator' || (settings.bcsHost === this.endpoint.host && settings.bcsPort === this.endpoint.port)) return

    this.reconfiguring = true
    try {
      await this.serial(async () => {
        const enabled = this.status.enabled
        this.enable(false)
        this.endpoint = { ...this.endpoint, host: settings.bcsHost, port: settings.bcsPort }
        this.catalogue = storedCatalogue ?? emptyCatalogue()
        this.routes.clear()
        this.set({ endpoint: endpointAddress(settings.bcsHost, settings.bcsPort) })
        this.enable(enabled)
      })
    } finally { this.reconfiguring = false }
  }

  enable(enabled: boolean) {
    if (enabled === this.status.enabled) return
    if (!enabled) {
      this.controller?.abort()
      this.controller = null
      this.connection?.close()
      this.connection = null
      this.set({ enabled: false, state: 'offline', connectedAt: null })
      return
    }
    const controller = new AbortController()
    this.controller = controller
    this.set({ enabled: true, state: 'connecting' })
    this.runner = this.runner.then(() => this.run(controller))
  }

  async stop() {
    this.enable(false)
    await this.runner
    await this.tail
  }

  private set(update: Partial<RouterStatus>, change: Change = {}) {
    this.status = { ...this.status, ...update }
    this.changed(change)
  }

  private serial<T>(action: () => Promise<T>) {
    const result = this.tail.then(action)
    this.tail = result.catch(() => {})
    return result
  }

  private update(id: string, points: Crosspoints, observations: RouteObservation[], take?: TakeObservation) {
    const previous = this.routes.get(id)
    const record = routeRecord(points, this.catalogue, previous)
    if (record === previous) return record
    this.routes.set(id, record)
    if (previous && this.observeRoutes) {
      const levels = sourceChanges(previous.levels, record.levels)
      if (levels.length) observations.push({ at: Date.now(), destinationId: id, take, levels })
    }
    this.changed({ destinationId: id })
    return record
  }

  fullSyncNow(username: string) {
    return this.requestSync({ trigger: 'manual', username })
  }

  private requestSync(origin: SyncOrigin) {
    if (this.syncRequest) return this.syncRequest
    const queuedAt = performance.now()
    this.syncRequest = this.withLink(async ({ gvg }) => {
      const started = performance.now()
      try {
        this.set({ state: 'syncing' }, { syncRouteIds: new Set() })
        const catalogue = await gvg.catalogues()
        const snapshot = await gvg.snapshot(catalogue, true)
        if (this.connection !== gvg || gvg.closed) throw new Error('GVG closed during full sync')
        const changed = JSON.stringify(catalogue) !== JSON.stringify(this.catalogue)
        const renamed = { sources: 0, destinations: 0, salvos: 0 }
        if (changed) {
          for (const rename of findCatalogueRenames(this.catalogue, catalogue)) renamed[rename.kind]++
        }
        const { routes, changedRouteIds, observations } = reconcileSnapshot(this.catalogue, this.routes, catalogue, snapshot)
        this.catalogue = catalogue
        this.routes = routes
        this.set({ state: 'live', syncGeneration: this.status.syncGeneration + 1, lastError: null },
          { catalogue: changed, syncRouteIds: changedRouteIds })
        this.syncFinishedAt = performance.now()
        const result = { changed, renamed, changedDestinations: observations.length, queueWaitMs: Math.round(started - queuedAt),
          syncMs: Math.round(this.syncFinishedAt - started) }
        if (observations.length) this.observeRoutes?.(observations)
        this.observeSync?.(result, origin)
        return result
      } catch (error) {
        gvg.close(error as Error)
        throw error
      }
    }).finally(() => { this.syncRequest = undefined })
    return this.syncRequest
  }

  private async run(controller: AbortController) {
    const signal = controller.signal
    while (!signal.aborted) {
      let link: Gvg | undefined
      const disconnected = new AbortController()
      const pollSignal = AbortSignal.any([signal, disconnected.signal])
      let retryAt = 0
      const failed = (error: Error) => {
        if (signal.aborted || disconnected.signal.aborted) return
        retryAt = performance.now() + RECONNECT_DELAY_MS
        disconnected.abort()
        this.set({ state: 'retrying', connectedAt: null, lastError: error.message })
      }
      try {
        this.set({ state: 'connecting', connectedAt: null })
        link = await Gvg.open(this.endpoint.host, this.endpoint.port, signal, (direction, packet) => this.observePacket?.(direction, packet))
        const active = link
        this.connection = active
        active.onClose = error => {
          if (this.connection === active) failed(error)
        }
        this.set({ state: 'syncing', connectedAt: Date.now() })
        const catalogue = await active.catalogues()
        await active.verifyEchoOff()
        const routes = await active.snapshot(catalogue)
        signal.throwIfAborted()
        if (active.closed) throw new Error('GVG closed during synchronization')
        this.catalogue = catalogue
        this.routes = new Map([...routes].map(([id, points]) => [id, routeRecord(points, catalogue)]))
        this.set({ state: 'live', syncGeneration: this.status.syncGeneration + 1, lastError: null }, { catalogue: true })
        this.syncFinishedAt = performance.now()
        let healthDue = Date.now() + 10_000
        while (!signal.aborted && !active.closed) {
          const started = Date.now()
          if (this.syncRequest) await this.syncRequest
          else if (!this.reconfiguring && performance.now() - this.syncFinishedAt >= this.fullSyncMinutes * 60_000) {
            await this.requestSync({ trigger: 'scheduled' })
          } else await this.serial(async () => {
            pollSignal.throwIfAborted()
            if (active.closed) throw new Error('GVG connection closed')
            if (Date.now() >= healthDue) {
              await active.health()
              healthDue = Date.now() + 10_000
            }
            const changes = await active.poll(this.catalogue)
            pollSignal.throwIfAborted()
            const observations: RouteObservation[] = []
            for (const [id, points] of changes) this.update(id, points, observations)
            if (observations.length) this.observeRoutes?.(observations)
          })
          await wait(Math.max(0, this.pollIntervalMs - (Date.now() - started)), undefined, { signal: pollSignal })
        }
        failed(new Error('GVG connection closed'))
      } catch (error) {
        failed(error as Error)
      } finally {
        if (this.connection === link) this.connection = null
        link?.close()
      }
      if (!signal.aborted) {
        await wait(Math.ceil(retryAt - performance.now()), undefined, { signal }).catch(() => {})
      }
    }
  }

  async withLink<T>(action: (link: Link) => Promise<T>) {
    if (this.reconfiguring) throw new Error('BCS endpoint is changing')
    const gvg = this.connection
    const generation = this.status.syncGeneration
    const ensure = () => {
      if (!gvg || this.connection !== gvg || gvg.closed || this.status.state !== 'live') throw new Error('Router is offline or synchronizing')
      if (this.status.syncGeneration !== generation) throw new Error('Router synchronized. Select the destination again.')
    }
    ensure()
    return this.serial(async () => {
      ensure()
      const read = async (id: string, take?: TakeObservation) => {
        ensure()
        try {
          const points = await gvg!.read(this.catalogue, id)
          ensure()
          const observations: RouteObservation[] = []
          const record = this.update(id, points, observations, take)
          if (observations.length) this.observeRoutes?.(observations)
          return record
        } catch (error) {
          gvg!.close()
          throw error
        }
      }
      return action({ gvg: gvg!, read, ensure })
    })
  }
}

