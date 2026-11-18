import type { Catalogue, RenameKind } from '../shared/model.ts'

export type CatalogueRename = { kind: RenameKind; previousName: string; name: string }

export function findCatalogueRenames(before: Catalogue, after: Catalogue): CatalogueRename[] {
  const changes: CatalogueRename[] = []
  for (const kind of ['sources', 'destinations'] as const) {
    const previous = new Map(before[kind].map(item => [item.id, item.name]))
    for (const { id, name } of after[kind]) {
      const previousName = previous.get(id)
      if (previousName?.trim() && name.trim() && previousName !== name) changes.push({ kind, previousName, name })
    }
  }

  // QN,V supplies names only, so infer a rename for one replacement even if BCS reorders the list.
  if (before.salvos.length === after.salvos.length) {
    const previous = new Set(before.salvos.map(item => item.name))
    const current = new Set(after.salvos.map(item => item.name))
    const removed = [...previous].filter(name => !current.has(name))
    const added = [...current].filter(name => !previous.has(name))
    if (removed.length === 1 && added.length === 1) changes.push({ kind: 'salvos', previousName: removed[0], name: added[0] })
  }
  return changes
}
