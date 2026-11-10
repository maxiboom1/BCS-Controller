import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Shuffle } from 'lucide-react'
import type { Binding, BoundItem, Route } from '../shared/model.ts'
import { groupRouteLevels, isMixedRoute } from './routeLevels.ts'

type Inspector = { id: string; anchor: HTMLButtonElement; pinned: boolean }

function LevelPopup({ id, label, anchor, levels, route, close, keepOpen, dismiss }: {
  id: string; label: string; anchor: HTMLButtonElement; levels: Binding[]; route: Route
  close: () => void; keepOpen: () => void; dismiss: () => void
}) {
  const popup = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = popup.current!
    function place() {
      const target = anchor.getBoundingClientRect()
      const grid = anchor.closest('.route-grid')?.getBoundingClientRect()
      if (!grid || target.bottom <= grid.top || target.top >= grid.bottom) { close(); return }
      const { width, height } = element.getBoundingClientRect()
      const edge = 8
      const left = Math.max(edge, Math.min(target.right - width, window.innerWidth - width - edge))
      const above = target.top - height - 4
      const top = above >= edge ? above : Math.max(edge, Math.min(target.bottom + 4, window.innerHeight - height - edge))
      element.style.left = `${left}px`
      element.style.top = `${top}px`
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchor, close, route, levels])
  useEffect(() => {
    function onPointer(event: PointerEvent) {
      if (event.target instanceof Node && !anchor.contains(event.target) && !popup.current?.contains(event.target)) close()
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); close() }
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [anchor, close])

  return createPortal(<div id={id} ref={popup} className="mix-popup" role="region" aria-label={'Routing levels for ' + label}
    onPointerEnter={keepOpen} onPointerLeave={dismiss}>
    <strong>{label}</strong>
    <dl>{groupRouteLevels(levels, route).map(group => <div key={group.id}>
      <dt>{group.label}</dt><dd>{group.source}{group.chopping && ' · Chopping'}</dd>
    </div>)}</dl>
  </div>, document.body)
}

export function DestinationGrid({ items, routes, levels, selection, busy, style, select }: {
  items: BoundItem[]; routes: Map<string, Route>; levels: Binding[]; selection: string; busy: boolean
  style: CSSProperties; select: (id: string) => void
}) {
  const [inspector, setInspector] = useState<Inspector>()
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const popupId = useId()
  const keepOpen = useCallback(() => clearTimeout(timer.current), [])
  const close = useCallback(() => { keepOpen(); setInspector(undefined) }, [keepOpen])
  useEffect(() => keepOpen, [keepOpen])

  const mixed = new Map<string, Route>()
  for (const item of items) {
    const route = item.valid ? routes.get(item.id) : undefined
    if (levels.length && route && isMixedRoute(route)) mixed.set(item.id, route)
  }
  const active = inspector && mixed.get(inspector.id)
  useEffect(() => { if (inspector && !active) close() }, [inspector, active, close])

  function preview(id: string, anchor: HTMLButtonElement) {
    keepOpen()
    setInspector(current => current?.pinned ? current : { id, anchor, pinned: false })
  }
  function dismiss() {
    keepOpen()
    timer.current = setTimeout(() => setInspector(current => current?.pinned ? current : undefined), 160)
  }

  return <section className="surface grid-section destinations" aria-labelledby="destinations-heading">
    <h2 id="destinations-heading" className="grid-heading">Destinations</h2>
    <div className="route-grid" style={style}>{items.map(item => {
      const expanded = !!active && inspector?.id === item.id
      return <div className="destination-key" key={item.id}>
        <button type="button" className={'route-key' + (item.id === selection ? ' active-destination' : '')}
          aria-pressed={item.id === selection} aria-description={item.valid ? undefined : 'Catalogue binding requires review'}
          title={item.label} disabled={busy} onClick={() => select(item.id)}><span>{item.label}</span></button>
        {mixed.has(item.id) && <button type="button" className="mix-key" aria-label={'Mixed levels for ' + item.label}
          aria-expanded={expanded} aria-controls={expanded ? popupId : undefined} aria-describedby={expanded ? popupId : undefined}
          onPointerEnter={event => { if (event.pointerType === 'mouse') preview(item.id, event.currentTarget) }}
          onPointerLeave={event => { if (event.pointerType === 'mouse') dismiss() }}
          onFocus={event => { if (event.currentTarget.matches(':focus-visible')) preview(item.id, event.currentTarget) }}
          onBlur={dismiss} onClick={event => {
            keepOpen()
            const anchor = event.currentTarget
            setInspector(current => current?.id === item.id && current.pinned ? undefined : { id: item.id, anchor, pinned: true })
          }}><Shuffle size={14} aria-hidden="true" /></button>}
      </div>
    })}</div>
    {active && inspector && <LevelPopup id={popupId} label={items.find(item => item.id === inspector.id)!.label}
      anchor={inspector.anchor} levels={levels} route={active} close={close} keepOpen={keepOpen} dismiss={dismiss} />}
  </section>
}
