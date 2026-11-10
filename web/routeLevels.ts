import type { Binding, Route } from '../shared/model.ts'

export function isMixedRoute(route: Route) {
  const points = Object.values(route.levels)
  return new Set(points.map(point => point.sourceId)).size > 1 || points.some(point => point.chopping)
}

export function groupRouteLevels(levels: Binding[], route: Route) {
  const groups: { id: string; label: string; sourceId: string | null | undefined; chopping: boolean; firstAudio: number; lastAudio: number }[] = []
  for (const level of levels) {
    const point = route.levels[level.id]
    const sourceId = point?.sourceId
    const chopping = point?.chopping ?? false
    const name = level.name.trim()
    const audio = Number(/^(?:AUDIO|AUD|A)\s*(\d+)$/i.exec(name)?.[1] ?? 0)
    const previous = groups.at(-1)
    if (audio > 0 && previous?.lastAudio && audio === previous.lastAudio + 1 &&
      sourceId === previous.sourceId && chopping === previous.chopping) {
      previous.lastAudio = audio
      previous.label = `A${previous.firstAudio}–${audio}`
    } else {
      const label = audio ? `A${audio}` : /^(?:V|VID|VIDEO)$/i.test(name) ? 'V' : name || level.id
      groups.push({ id: level.id, label, sourceId, chopping, firstAudio: audio, lastAudio: audio })
    }
  }
  return groups.map(({ id, label, sourceId, chopping }) => ({
    id, label, source: sourceId === undefined ? 'Unavailable' : sourceId === null ? 'No crosspoint' : route.sourceLabels[sourceId] ?? sourceId,
    chopping,
  }))
}
