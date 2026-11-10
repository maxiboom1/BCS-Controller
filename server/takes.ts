import { setTimeout as wait } from 'node:timers/promises'
import type { Panel, TakeInput, TakeResult } from '../shared/model.ts'
import type { Store } from './db.ts'
import type { Router } from './router.ts'
import { validBindings, viewRoute } from './views.ts'
import { levelMask } from './wire.ts'

export function takeService(db: Store, router: Router) {
  const running = new Map<string, Promise<TakeResult>>()
  return async (userId: string, panelId: string, input: TakeInput, authorized: () => Panel): Promise<TakeResult> => {
    authorized()
    const key = userId + ':' + input.actionId
    const fingerprint = JSON.stringify([panelId, input])
    const previous = db.take(userId, input.actionId)
    if (previous) {
      if (previous.fingerprint !== fingerprint) return { outcome: 'conflict', message: 'Action ID already used for another route.' }
      if (previous.result) return JSON.parse(previous.result) as TakeResult
      return running.get(key) ?? { outcome: 'uncertain', message: 'TAKE status is unknown. Check current routing.' }
    }
    db.recordTake(userId, input.actionId, fingerprint)
    let attempted = false
    const route = () => viewRoute(db, router, input.destinationId)
    const conflict = (): TakeResult => ({ outcome: 'conflict', message: 'Routing changed. Review the new status before trying again.', route: route() })
    const task = router.withLink(async link => {
      function validate() {
        const panel = authorized()
        if (panel.version !== input.panelVersion) throw new Error('Panel configuration changed. Reload this panel.')
        const source = panel.sources.find(item => item.id === input.sourceId)
        const destination = panel.destinations.find(item => item.id === input.destinationId)
        if (!source || !destination) throw new Error('Source or destination is outside this panel.')
        const levels = panel.levels ?? panel.allLevelBindings ?? []
        if (!validBindings(router.catalogue.sources, [source]) ||
            !validBindings(router.catalogue.destinations, [destination]) ||
            !levels.length || !validBindings(router.catalogue.levels, levels) ||
            (panel.levels === null && levels.length !== router.catalogue.levels.length)) {
          throw new Error('Catalogue bindings changed. Ask an admin to review this panel.')
        }
        if (!router.status.writes) throw new Error('Live routing is disabled in read-only mode.')
        if (panel.levels && !router.status.selectedLevels) throw new Error('Selected-level routing is gated for this live service.')
        return { source, destination, levels, all: panel.levels === null }
      }
      validate()
      if (route()?.revision !== input.revision) return conflict()
      const before = await link.read(input.destinationId)
      const { source, destination, levels, all } = validate()
      if (before.revision !== input.revision) return conflict()
      const blocked = levels.filter(level => {
        const point = before.levels[level.id]
        return !point?.sourceId || point.protected || point.chopping
      })
      if (blocked.length) throw new Error('Unresolved, protected, or chopping levels: ' + blocked.map(level => level.name).join(', '))
      const matches = (points: typeof before.levels) => levels.every(level => {
        const point = points[level.id]
        return point?.sourceId === input.sourceId && !point.chopping
      })
      if (matches(before.levels)) return { outcome: 'confirmed', message: 'Already routed on every requested level.', route: route() } as const

      link.ensure()
      db.attempted(userId, input.actionId)
      attempted = true
      await link.gvg.take(destination.name, source.name, all ? undefined : levelMask(levels.map(level => level.id)))
      for (let attempt = 0; attempt < 4; attempt++) {
        await wait(200)
        const after = await link.read(input.destinationId)
        if (matches(after.levels)) return { outcome: 'confirmed', message: 'TAKE verified on every requested level.', route: route() } as const
      }
      return { outcome: 'mismatch', message: 'Readback did not match every requested level.', route: route() } as const
    }).catch((error: Error): TakeResult => attempted
      ? { outcome: 'uncertain', message: 'Outcome uncertain. Check the destination after reconnecting.' }
      : { outcome: 'blocked', message: error.message })
      .then(result => {
        db.finishTake(userId, input.actionId, result)
        return result
      })
      .finally(() => running.delete(key))
    running.set(key, task)
    return task
  }
}

