import type { AdminPanelView, Binding, BoundItem, Item, Kind, Panel, PanelView, Route } from '../shared/model.ts'
import type { Router } from './router.ts'
import type { Store } from './db.ts'

function bind(db: Store, router: Router, kind: Kind, items: Binding[]): BoundItem[] {
  const current = new Map(router.catalogue[kind].map(item => [item.id, item]))
  return items.map(binding => ({
    ...binding, valid: current.get(binding.id)?.name === binding.name, label: db.alias(kind, binding) || binding.name,
  }))
}

export function viewPanel(db: Store, router: Router, panel: Panel): PanelView {
  const { allLevelBindings, salvos, ...configuration } = panel
  const levels = bind(db, router, 'levels', panel.levels ?? allLevelBindings ?? [])
  return {
    ...configuration, sources: bind(db, router, 'sources', panel.sources), destinations: bind(db, router, 'destinations', panel.destinations),
    levels, allLevels: panel.levels === null, validLevels: levels.length > 0 && levels.every(item => item.valid) &&
      (panel.levels !== null || levels.length === router.catalogue.levels.length),
  }
}

export function viewAdminPanel(db: Store, router: Router, panel: Panel): AdminPanelView {
  return { ...viewPanel(db, router, panel), salvos: bind(db, router, 'salvos', panel.salvos ?? []) }
}

export function viewRoute(db: Store, router: Router, id: string): Route | undefined {
  const status = router.routes.get(id)
  if (!status) return
  const sourceIds = new Set(Object.values(status.levels).map(point => point.sourceId))
  const sourceLabels = Object.fromEntries(router.catalogue.sources
    .filter(source => sourceIds.has(source.id)).map(item => [item.id, db.alias('sources', item) || item.name]))
  return { ...status, destinationId: id, sourceLabels }
}

export function validBindings(catalogue: Item[], bindings: Binding[]) {
  const names = new Map(catalogue.map(item => [item.id, item.name]))
  return new Set(bindings.map(item => item.id)).size === bindings.length &&
    bindings.every(item => item.name.trim() && names.get(item.id) === item.name)
}

