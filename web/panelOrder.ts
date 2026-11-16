import type { Binding, BoundItem } from '../shared/model.ts'

export function shiftAssignments<T extends Binding>(items: T[], selected: ReadonlySet<string>, direction: -1 | 1) {
  const ordered = [...items]
  let moved = false
  const start = direction === -1 ? 1 : ordered.length - 2
  const end = direction === -1 ? ordered.length : -1
  for (let index = start; direction === -1 ? index < end : index > end; index -= direction) {
    const item = ordered[index]
    const adjacent = ordered[index + direction]
    if (item && adjacent && selected.has(item.id) && !selected.has(adjacent.id)) {
      ordered[index] = adjacent
      ordered[index + direction] = item
      moved = true
    }
  }
  return moved ? ordered : items
}

const alphabet = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

export function sortAssignments<T extends BoundItem>(items: T[], catalogue: Binding[], mode: 'database' | 'label') {
  const order = new Map(catalogue.map((row, index) => [row.id, index]))
  const rank = (row: T) => row.valid ? order.get(row.id) ?? catalogue.length : catalogue.length
  return [...items].sort((a, b) => (mode === 'label' ? alphabet.compare(a.label, b.label) : 0) || rank(a) - rank(b))
}
