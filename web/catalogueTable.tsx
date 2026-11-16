import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

const ROW_HEIGHT = 32
const OVERSCAN = 6

type Selection = {
  ids: ReadonlySet<string>
  active: string
  select: (index: number, mode: 'single' | 'toggle' | 'range' | 'focus') => void
}

export function CatalogueTable<T extends { id: string }>({ label, columns, rows, render, empty, selection }: {
  label: string; columns: string[]; rows: T[]; render: (row: T) => ReactNode; empty: string; selection?: Selection
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const table = useRef<HTMLTableElement>(null)
  const rowId = useId()
  const [top, setTop] = useState(0)
  const [height, setHeight] = useState(384)
  const start = Math.max(0, Math.min(rows.length, Math.floor(top / ROW_HEIGHT)) - OVERSCAN)
  const end = Math.min(rows.length, start + Math.ceil(height / ROW_HEIGHT) + 2 * OVERSCAN)
  const active = selection ? rows.findIndex(row => row.id === selection.active) : -1
  useLayoutEffect(() => {
    const element = viewport.current!
    const measure = () => { setHeight(element.clientHeight); setTop(element.scrollTop) }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (viewport.current) setTop(viewport.current.scrollTop)
  }, [rows.length])

  function scrollToRow(index: number) {
    const element = viewport.current!
    const rowTop = index * ROW_HEIGHT
    if (rowTop < element.scrollTop) element.scrollTop = rowTop
    else if (rowTop + 2 * ROW_HEIGHT > element.scrollTop + height) {
      element.scrollTop = rowTop + 2 * ROW_HEIGHT - height
    }
  }

  return <div className="table-scroll catalogue-scroll" ref={viewport} onScroll={event => setTop(event.currentTarget.scrollTop)}>
    <table ref={table} className="catalogue-table" style={{ '--catalogue-row-height': ROW_HEIGHT + 'px' } as CSSProperties}
      aria-label={label} aria-rowcount={rows.length + 1} role={selection ? 'grid' : undefined}
      aria-multiselectable={selection ? true : undefined} tabIndex={selection ? 0 : undefined}
      aria-activedescendant={active >= start && active < end ? rowId + active : undefined}
      onKeyDown={selection ? event => {
        if (!rows.length) return
        const current = Math.max(0, active)
        const page = Math.max(1, Math.floor(height / ROW_HEIGHT) - 1)
        const position = { ArrowUp: active < 0 ? 0 : current - 1, ArrowDown: active < 0 ? 0 : current + 1,
          PageUp: current - page, PageDown: current + page, Home: 0, End: rows.length - 1 }[event.key]
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault()
          selection.select(current, event.shiftKey ? 'range' : 'toggle')
          scrollToRow(current)
        } else if (position !== undefined) {
          event.preventDefault()
          const next = Math.max(0, Math.min(rows.length - 1, position))
          selection.select(next, event.shiftKey ? 'range' : 'focus')
          scrollToRow(next)
        }
      } : undefined}>
      <thead><tr>{columns.map(column => <th scope="col" key={column}>{column}</th>)}</tr></thead>
      <tbody>
        {start > 0 && <tr className="table-spacer" aria-hidden="true"><td colSpan={columns.length} style={{ height: start * ROW_HEIGHT }} /></tr>}
        {rows.slice(start, end).map((row, offset) => {
          const index = start + offset
          return <tr key={row.id} id={rowId + index} aria-rowindex={index + 2}
            aria-selected={selection?.ids.has(row.id)} data-active={selection && active === index ? true : undefined}
            onClick={selection ? event => {
              selection.select(index, event.shiftKey ? 'range' : event.ctrlKey || event.metaKey ? 'toggle' : 'single')
              table.current?.focus({ preventScroll: true })
            } : undefined}>{render(row)}</tr>
        })}
        {end < rows.length && <tr className="table-spacer" aria-hidden="true"><td colSpan={columns.length} style={{ height: (rows.length - end) * ROW_HEIGHT }} /></tr>}
        {!rows.length && <tr><td className="empty-cell" colSpan={columns.length}>{empty}</td></tr>}
      </tbody>
    </table>
  </div>
}
