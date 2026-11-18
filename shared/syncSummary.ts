import type { FullSyncResult } from './model.ts'

export function describeSyncChanges({ changed, renamed, changedDestinations }: FullSyncResult) {
  const changes = [
    [renamed.sources, 'source', ' renamed'],
    [renamed.destinations, 'destination', ' renamed'],
    [renamed.salvos, 'salvo', ' renamed'],
    [changedDestinations, 'destination', ' with route changes'],
  ] as const
  const summary = changes.flatMap(([count, name, description]) =>
    count ? [`${count} ${name}${count === 1 ? '' : 's'}${description}`] : [])
  if (changed && !Object.values(renamed).some(Boolean)) summary.push('Catalogue updated')
  return summary.join(' · ') || 'No changes'
}
