import { useMemo, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react'
import type { BoundItem } from '../shared/model.ts'
import { CatalogueTable } from './catalogueTable.tsx'
import { Notice, SearchBox, useCatalogue } from './components.tsx'
import { shiftAssignments, sortAssignments } from './panelOrder.ts'

function useRowSelection(rows: BoundItem[]) {
  const [ids, setIds] = useState<Set<string>>(new Set())
  const [active, setActive] = useState('')
  const [anchor, setAnchor] = useState('')

  function replace(selected: BoundItem[]) {
    setIds(new Set(selected.map(row => row.id)))
    const first = selected[0]?.id ?? ''
    setActive(first)
    setAnchor(first)
  }

  function select(index: number, mode: 'single' | 'toggle' | 'range' | 'focus') {
    const id = rows[index].id
    setActive(id)
    if (mode === 'range') {
      const origin = rows.findIndex(row => row.id === anchor)
      if (origin >= 0) {
        setIds(new Set(rows.slice(Math.min(index, origin), Math.max(index, origin) + 1).map(row => row.id)))
        return
      }
      replace([rows[index]])
      return
    }
    setAnchor(id)
    if (mode === 'single') setIds(new Set([id]))
    if (mode === 'toggle') setIds(previous => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return { ids, active, select, replace }
}

export function AssignmentPicker({ kind, items, change, refresh }: {
  kind: 'sources' | 'destinations' | 'salvos'; items: BoundItem[]; change: (rows: BoundItem[]) => void; refresh: number
}) {
  const listing = useCatalogue(kind, refresh)
  const [query, setQuery] = useState('')
  const assigned = useMemo(() => {
    if (listing.loading || listing.error) return items
    const current = new Map(listing.items.map(row => [row.id, row]))
    return items.map(item => {
      const row = current.get(item.id)
      return row?.name === item.name ? { ...item, valid: true, label: row.label } : { ...item, valid: false }
    })
  }, [items, listing.items, listing.loading, listing.error])
  const available = useMemo(() => {
    const ids = new Set(items.map(row => row.id))
    const needle = query.trim().toLowerCase()
    return listing.items.filter(row => !ids.has(row.id) && (row.name + ' ' + row.label).toLowerCase().includes(needle))
      .map(({ id, name, label }) => ({ id, name, label, valid: true }))
  }, [items, listing.items, query])
  const left = useRowSelection(available)
  const right = useRowSelection(assigned)
  const adding = available.filter(row => left.ids.has(row.id))
  const removing = assigned.some(row => right.ids.has(row.id))
  const up = shiftAssignments(assigned, right.ids, -1)
  const down = shiftAssignments(assigned, right.ids, 1)
  const overLimit = assigned.length + adding.length > 500

  function add() {
    change([...assigned, ...adding])
    right.replace(adding)
    left.replace([])
  }

  function remove() {
    const removed = assigned.filter(row => right.ids.has(row.id))
    change(assigned.filter(row => !right.ids.has(row.id)))
    left.replace(removed)
    right.replace([])
  }

  return <>
    {listing.error && <Notice error>{listing.error}</Notice>}
    {overLimit && <Notice error>A panel can contain up to 500 {kind}.</Notice>}
    <div className="assignment-picker">
      <div className="assignment-side">
        <div className="assignment-toolbar"><SearchBox label={'Find ' + kind} value={query}
          onChange={value => { setQuery(value); left.replace([]) }} /></div>
        <CatalogueTable label={'Available ' + kind} columns={['Available']} rows={available} selection={left}
          empty={listing.loading ? 'Loading catalogue…' : 'No matching entries.'} render={row => <td title={row.name}>{row.label}</td>} />
      </div>
      <div className="transfer-actions">
        <button type="button" className="icon-button transfer-add" aria-label={'Assign selected ' + kind} title={'Assign selected ' + kind}
          disabled={!adding.length || overLimit} onClick={add}><ArrowRight size={18} /></button>
        <button type="button" className="icon-button transfer-remove" aria-label={'Remove selected ' + kind} title={'Remove selected ' + kind}
          disabled={!removing} onClick={remove}><ArrowLeft size={18} /></button>
      </div>
      <div className="assignment-side">
        <div className="assignment-toolbar">
          <button type="button" disabled={assigned.length < 2 || listing.loading || !!listing.error}
            onClick={() => change(sortAssignments(assigned, listing.items, 'database'))}>Database order</button>
          <button type="button" disabled={assigned.length < 2}
            onClick={() => change(sortAssignments(assigned, listing.items, 'label'))}>A–Z</button>
          <button type="button" aria-label={'Move selected ' + kind + ' up'} title="Move up" disabled={up === assigned}
            onClick={() => change(up)}><ArrowUp size={16} /></button>
          <button type="button" aria-label={'Move selected ' + kind + ' down'} title="Move down" disabled={down === assigned}
            onClick={() => change(down)}><ArrowDown size={16} /></button>
        </div>
        <CatalogueTable label={'Assigned ' + kind} columns={['Assigned']} rows={assigned} selection={right}
          empty={'No ' + kind + ' assigned.'} render={row => <td title={row.name}>{row.label}
            {!row.valid && <small className="danger"> · Review binding</small>}</td>} />
      </div>
    </div>
  </>
}
