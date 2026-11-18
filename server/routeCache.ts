import { randomUUID } from 'node:crypto'
import type { Catalogue, Crosspoints, Item } from '../shared/model.ts'
import type { RouteObservation } from './router.ts'

export type StatusRecord = { revision: string; levels: Crosspoints }

export function routeRecord(points: Crosspoints, catalogue: Catalogue, previous?: StatusRecord): StatusRecord {
  const levels: Crosspoints = Object.fromEntries(catalogue.levels.map(({ id }) =>
    [id, points[id] ?? { sourceId: null, protected: false, chopping: false }]))
  if (previous && Object.keys(previous.levels).length === catalogue.levels.length &&
      Object.entries(levels).every(([id, point]) => {
        const before = previous.levels[id]
        return before?.sourceId === point.sourceId && before.protected === point.protected && before.chopping === point.chopping
      })) return previous
  return { levels, revision: randomUUID() }
}

export function sourceChanges(before: Crosspoints, after: Crosspoints) {
  return Object.entries(after).flatMap(([id, { sourceId, chopping }]) =>
    before[id] && before[id].sourceId !== sourceId ? [{ id, sourceId, chopping }] : [])
}

function stableIds(before: Item[], after: Item[]) {
  const names = new Map(before.map(item => [item.id, item.name]))
  return new Set(after.filter(item => names.get(item.id) === item.name).map(item => item.id))
}

export function reconcileSnapshot(previousCatalogue: Catalogue, previousRoutes: ReadonlyMap<string, StatusRecord>,
  catalogue: Catalogue, snapshot: ReadonlyMap<string, Crosspoints>) {
  const stableDestinations = stableIds(previousCatalogue.destinations, catalogue.destinations)
  const stableSources = stableIds(previousCatalogue.sources, catalogue.sources)
  const stableLevels = stableIds(previousCatalogue.levels, catalogue.levels)
  const routes = new Map<string, StatusRecord>()
  const observations: RouteObservation[] = []
  const changedRouteIds = new Set<string>()
  function comparableSource(id: string | null) { return id === null || stableSources.has(id) }

  for (const [id, points] of snapshot) {
    const previous = previousRoutes.get(id)
    const record = routeRecord(points, catalogue, previous)
    routes.set(id, record)
    if (record === previous) continue
    changedRouteIds.add(id)
    if (!previous || !stableDestinations.has(id)) continue
    const levels = sourceChanges(previous.levels, record.levels).filter(level =>
      stableLevels.has(level.id) && comparableSource(level.sourceId) && comparableSource(previous.levels[level.id].sourceId))
    if (levels.length) observations.push({ at: Date.now(), destinationId: id, levels })
  }
  for (const id of previousRoutes.keys()) if (!routes.has(id)) changedRouteIds.add(id)
  return { routes, changedRouteIds, observations }
}
