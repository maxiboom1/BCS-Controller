import { randomUUID } from 'node:crypto'
import { setTimeout as wait } from 'node:timers/promises'
import { emptyCatalogue } from '../shared/model.ts'
import type { Catalogue, Crosspoints, RouterStatus } from '../shared/model.ts'
import { Gvg } from './gvg.ts'

export type Endpoint = { host: string; port: number; mode: RouterStatus['mode']; selectedLevels: boolean }
type StatusRecord = { revision: string; levels: Crosspoints }
type Change = { destinationId?: string; catalogue?: boolean }
export type Link = { gvg: Gvg; read: (id: string) => Promise<StatusRecord>; ensure: () => void }

export class Router {
  catalogue: Catalogue = emptyCatalogue()
  routes = new Map<string, StatusRecord>()
  status: RouterStatus
  changed = (_change: Change) => {}
  private endpoint: Endpoint
  private controller: AbortController | null = null
  private connection: Gvg | null = null
  private tail: Promise<unknown> = Promise.resolve()
  private runner: Promise<void> = Promise.resolve()

  constructor(endpoint: Endpoint, storedCatalogue?: Catalogue) {
    this.endpoint = endpoint
    if (storedCatalogue) this.catalogue = storedCatalogue
    this.status = {
      state: 'offline', enabled: false, connectedAt: null, lastError: null,
      mode: endpoint.mode, endpoint: endpoint.mode === 'simulator' ? 'Local GVG simulator' : endpoint.host + ':' + endpoint.port,
      writes: endpoint.mode !== 'live-readonly', selectedLevels: endpoint.selectedLevels || endpoint.mode === 'simulator',
    }
  }

  enable(enabled: boolean) {
    if (enabled === this.status.enabled) return
    if (!enabled) {
      this.controller?.abort()
      this.controller = null
      this.connection?.close()
      this.connection = null
      this.set({ enabled: false, state: 'offline', connectedAt: null, lastError: null })
      return
    }
    const controller = new AbortController()
    this.controller = controller
    this.set({ enabled: true, state: 'connecting', lastError: null })
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

  private update(id: string, points: Crosspoints) {
    const levels = this.normalize(points)
    const previous = this.routes.get(id)
    if (previous && JSON.stringify(previous.levels) === JSON.stringify(levels)) return previous
    const record = { levels, revision: randomUUID() }
    this.routes.set(id, record)
    this.changed({ destinationId: id })
    return record
  }

  private async run(controller: AbortController) {
    const signal = controller.signal
    let delay = 1000
    while (!signal.aborted) {
      let link: Gvg | undefined
      try {
        this.set({ state: 'connecting', connectedAt: null })
        link = await Gvg.open(this.endpoint.host, this.endpoint.port, signal)
        const active = link
        this.connection = active
        active.onClose = error => {
          if (this.connection === active && !signal.aborted) {
            this.set({ state: 'retrying', connectedAt: null, lastError: error.message })
          }
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
        this.set({ state: 'live', lastError: null }, true)
        delay = 1000
        let healthDue = Date.now() + 10_000
        let refreshDue = Date.now() + 300_000
        while (!signal.aborted && !active.closed) {
          const started = Date.now()
          await this.serial(async () => {
            signal.throwIfAborted()
            if (active.closed) throw new Error('GVG connection closed')
            if (Date.now() >= healthDue) {
              await active.health()
              healthDue = Date.now() + 10_000
            }
            if (Date.now() >= refreshDue) {
              const fresh = await active.catalogues()
              if (JSON.stringify(fresh) !== JSON.stringify(this.catalogue)) throw new Error('BCS catalogue changed, resynchronizing')
              refreshDue = Date.now() + 300_000
            }
            const changes = await active.poll(this.catalogue)
            signal.throwIfAborted()
            for (const [id, points] of changes) this.update(id, points)
          })
          await wait(Math.max(0, 1000 - (Date.now() - started)), undefined, { signal })
        }
        if (!signal.aborted) throw new Error(this.status.lastError ?? 'GVG connection closed')
      } catch (error) {
        if (!signal.aborted) this.set({ state: 'retrying', connectedAt: null, lastError: (error as Error).message })
      } finally {
        if (this.connection === link) this.connection = null
        link?.close()
      }
      if (!signal.aborted) {
        await wait(delay, undefined, { signal }).catch(() => {})
        delay = Math.min(delay * 2, 30_000)
      }
    }
  }

  async withLink<T>(action: (link: Link) => Promise<T>) {
    const gvg = this.connection
    const ensure = () => {
      if (!gvg || this.connection !== gvg || gvg.closed || this.status.state !== 'live') throw new Error('Router is offline or synchronizing')
    }
    ensure()
    return this.serial(async () => {
      ensure()
      const read = async (id: string) => {
        ensure()
        try {
          const points = await gvg!.read(this.catalogue, id)
          ensure()
          return this.update(id, points)
        } catch (error) {
          gvg!.close()
          throw error
        }
      }
      return action({ gvg: gvg!, read, ensure })
    })
  }
}

