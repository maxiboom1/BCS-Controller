import { randomUUID } from 'node:crypto'
import { setTimeout as wait } from 'node:timers/promises'
import { emptyCatalogue } from '../shared/model.ts'
import type { Catalogue, ControllerSettings, Crosspoints, RouterStatus } from '../shared/model.ts'
import { Gvg } from './gvg.ts'
import type { PacketObserver } from './gvg.ts'
import { DEFAULT_SETTINGS, endpointAddress } from './settings.ts'

export type Endpoint = { host: string; port: number; mode: RouterStatus['mode']; selectedLevels: boolean }
type StatusRecord = { revision: string; levels: Crosspoints }
type Change = { destinationId?: string; catalogue?: boolean }
type RouterSettings = Pick<ControllerSettings, 'bcsHost' | 'bcsPort' | 'pollIntervalMs' | 'catalogueCheckMinutes'>
export type TakeObservation = {
  actionKey: string; username: string; ip: string | null; panelName: string; sourceId: string; levelIds: ReadonlySet<string>
}
export type RouteObservation = {
  at: number; destinationId: string; levels: { id: string; sourceId: string | null; chopping: boolean }[]; take?: TakeObservation
}
export type Link = { gvg: Gvg; read: (id: string, take?: TakeObservation) => Promise<StatusRecord>; ensure: () => void }

const RECONNECT_DELAY_MS = 5000
const CATALOGUE_CHANGED = 'BCS catalogue changed, resynchronizing'

export class Router {
  catalogue: Catalogue = emptyCatalogue()
  routes = new Map<string, StatusRecord>()
  status: RouterStatus
  changed = (_change: Change) => {}
  observeRoutes?: (observations: RouteObservation[]) => void
  observePacket?: PacketObserver
  private endpoint: Endpoint
  private controller: AbortController | null = null
  private connection: Gvg | null = null
  private tail: Promise<unknown> = Promise.resolve()
  private runner: Promise<void> = Promise.resolve()
  private reconfiguring = false
  private pollIntervalMs: number
  private catalogueCheckMinutes: number
  private catalogueCheckedAt = 0
  private catalogueRefresh?: Promise<boolean>

  constructor(endpoint: Endpoint, storedCatalogue?: Catalogue, pollIntervalMs = DEFAULT_SETTINGS.pollIntervalMs,
    catalogueCheckMinutes = DEFAULT_SETTINGS.catalogueCheckMinutes) {
    this.endpoint = endpoint
    this.pollIntervalMs = pollIntervalMs
    this.catalogueCheckMinutes = catalogueCheckMinutes
    if (storedCatalogue) this.catalogue = storedCatalogue
    this.status = {
      state: 'offline', enabled: false, connectedAt: null, lastError: null,
      mode: endpoint.mode, endpoint: endpoint.mode === 'simulator' ? 'Local GVG simulator' : endpointAddress(endpoint.host, endpoint.port),
      writes: endpoint.mode !== 'live-readonly', selectedLevels: endpoint.selectedLevels || endpoint.mode === 'simulator',
    }
  }

  async configure(settings: RouterSettings, storedCatalogue?: Catalogue) {
    this.pollIntervalMs = settings.pollIntervalMs
    this.catalogueCheckMinutes = settings.catalogueCheckMinutes
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

  private set(update: Partial<RouterStatus>, catalogue = false) {
    this.status = { ...this.status, ...update }
    this.changed({ catalogue })
  }

  private serial<T>(action: () => Promise<T>) {
    const result = this.tail.then(action)
    this.tail = result.catch(() => {})
    return result
  }

  private normalize(points: Crosspoints): Crosspoints {
    return Object.fromEntries(this.catalogue.levels.map(({ id }) =>
      [id, points[id] ?? { sourceId: null, protected: false, chopping: false }]))
  }

  private update(id: string, points: Crosspoints, observations: RouteObservation[], take?: TakeObservation) {
    const levels = this.normalize(points)
    const previous = this.routes.get(id)
    if (previous && JSON.stringify(previous.levels) === JSON.stringify(levels)) return previous
    const record = { levels, revision: randomUUID() }
    this.routes.set(id, record)
    if (previous && this.observeRoutes) {
      const changed = Object.entries(levels).filter(([id, point]) => previous.levels[id]?.sourceId !== point.sourceId)
      if (changed.length) observations.push({ at: Date.now(), destinationId: id, take,
        levels: changed.map(([id, { sourceId, chopping }]) => ({ id, sourceId, chopping })) })
    }
    this.changed({ destinationId: id })
    return record
  }

  private async checkCatalogue(gvg: Gvg) {
    const fresh = await gvg.catalogues()
    this.catalogueCheckedAt = performance.now()
    return JSON.stringify(fresh) !== JSON.stringify(this.catalogue)
  }

  refreshCatalogue() {
    this.catalogueRefresh ??= this.withLink(async ({ gvg, ensure }) => {
      try {
        const changed = await this.checkCatalogue(gvg)
        ensure()
        if (changed) gvg.close(new Error(CATALOGUE_CHANGED))
        return changed
      } catch (error) {
        gvg.close(error as Error)
        throw error
      }
    }).finally(() => { this.catalogueRefresh = undefined })
    return this.catalogueRefresh
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
        this.routes = new Map([...routes].map(([id, points]) =>
          [id, { levels: this.normalize(points), revision: randomUUID() }]))
        this.catalogueCheckedAt = performance.now()
        this.set({ state: 'live', lastError: null }, true)
        let healthDue = Date.now() + 10_000
        while (!signal.aborted && !active.closed) {
          const started = Date.now()
          await this.serial(async () => {
            pollSignal.throwIfAborted()
            if (active.closed) throw new Error('GVG connection closed')
            if (Date.now() >= healthDue) {
              await active.health()
              healthDue = Date.now() + 10_000
            }
            if (performance.now() - this.catalogueCheckedAt >= this.catalogueCheckMinutes * 60_000) {
              if (await this.checkCatalogue(active)) throw new Error(CATALOGUE_CHANGED)
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
    const ensure = () => {
      if (!gvg || this.connection !== gvg || gvg.closed || this.status.state !== 'live') throw new Error('Router is offline or synchronizing')
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

