import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertCircle, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import type { Kind, RouterStatus } from '../shared/model.ts'
import { catalogue } from './api.ts'
import type { CataloguePage } from './api.ts'

export function StatusBadge({ status }: { status: RouterStatus }) {
  const label = { offline: 'Disconnected', connecting: 'Connecting', syncing: 'Synchronizing', retrying: 'Reconnecting', live: 'Connected' }[status.state]
  return <span className={'status ' + status.state}><span className="dot" aria-hidden="true" />{label}</span>
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

export function Pagination({ page, total, change }: { page: number; total: number; change: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / 50))
  return <div className="pagination">
    <span>{total.toLocaleString()} entries · Page {page} of {pages}</span>
    <button className="icon-button" type="button" aria-label="Previous page" disabled={page === 1} onClick={() => change(page - 1)}><ChevronLeft size={18} /></button>
    <button className="icon-button" type="button" aria-label="Next page" disabled={page >= pages} onClick={() => change(page + 1)}><ChevronRight size={18} /></button>
  </div>
}

export function useCatalogue(kind: Kind, refresh: number) {
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [result, setResult] = useState<CataloguePage>({ items: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    const timer = setTimeout(() => {
      catalogue(kind, q, page, controller.signal).then(value => {
        setResult(value)
        if (page > Math.max(1, Math.ceil(value.total / 50))) setPage(1)
      }).catch((err: Error) => {
        if (!controller.signal.aborted) setError(err.message)
      }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, 150)
    return () => { clearTimeout(timer); controller.abort() }
  }, [kind, q, page, refresh])
  return { q, setQ: (value: string) => { setQ(value); setPage(1) }, page, setPage, result, loading, error }
}

