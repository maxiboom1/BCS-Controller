import { useEffect, useId, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertCircle, Search } from 'lucide-react'
import type { Kind, RouterStatus } from '../shared/model.ts'
import { catalogue } from './api.ts'
import type { CatalogueRow } from './api.ts'

export function StatusBadge({ status }: { status: RouterStatus }) {
  const label = { offline: 'Disconnected', connecting: 'Connecting', syncing: 'Synchronizing', retrying: 'Reconnecting', live: 'Connected' }[status.state]
  return <span className={'status ' + status.state} title={status.lastError ?? undefined}><span className="dot" aria-hidden="true" />{label}</span>
}

export function elapsedClock(now: number, since: number) {
  const seconds = Math.max(0, Math.floor((now - since) / 1000))
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(value => String(value).padStart(2, '0')).join(':')
}

export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div className={'notice' + (error ? ' error' : '')} role={error ? 'alert' : 'status'}>
    {error && <AlertCircle size={17} aria-hidden="true" />}{children}
  </div>
}

export function SearchBox({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return <label className="search"><Search size={17} aria-hidden="true" />
    <input value={value} onChange={event => onChange(event.target.value)} placeholder={label} aria-label={label} />
  </label>
}

export function useCatalogue(kind: Kind, refresh: number) {
  const [items, setItems] = useState<CatalogueRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    catalogue(kind, controller.signal).then(value => {
      if (!controller.signal.aborted) setItems(value.items)
    }).catch((err: Error) => {
      if (!controller.signal.aborted) setError(err.message)
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [kind, refresh])
  return { items, loading, error }
}

export function Tabs<T extends string>({ label, tabs, active, change, children }: {
  label: string; tabs: readonly T[]; active: T; change: (tab: T) => void; children: ReactNode
}) {
  const id = useId()
  return <>
    <div className="admin-tabs" role="tablist" aria-label={label}>{tabs.map((tab, index) =>
      <button key={tab} id={id + index} type="button" role="tab" aria-selected={active === tab}
        tabIndex={active === tab ? 0 : -1} aria-controls={id + '-panel'} onClick={() => change(tab)}
        onKeyDown={event => {
          const next = { ArrowLeft: (index - 1 + tabs.length) % tabs.length, ArrowRight: (index + 1) % tabs.length,
            Home: 0, End: tabs.length - 1 }[event.key]
          if (next === undefined) return
          event.preventDefault()
          change(tabs[next])
          document.getElementById(id + next)?.focus()
        }}>{tab}</button>
    )}</div>
    <div role="tabpanel" aria-labelledby={id + tabs.indexOf(active)} id={id + '-panel'}>{children}</div>
  </>
}

