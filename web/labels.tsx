import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import { api } from './api.ts'
import type { CatalogueRow } from './api.ts'
import { CatalogueTable } from './catalogueTable.tsx'
import { Notice, SearchBox, Tabs, useCatalogue } from './components.tsx'

type AliasKind = 'sources' | 'destinations' | 'salvos'
const labelTabs = ['Sources', 'Destinations', 'Salvos'] as const
const labelTabKinds = { Sources: 'sources', Destinations: 'destinations', Salvos: 'salvos' } as const satisfies Record<typeof labelTabs[number], AliasKind>

export function LabelsTab({ refresh }: { refresh: number }) {
  const [tab, setTab] = useState<(typeof labelTabs)[number]>('Sources')
  return <div className="admin-view">
    <Tabs label="Labels" tabs={labelTabs} active={tab} change={setTab}>
      <AliasTable key={tab} kind={labelTabKinds[tab]} refresh={refresh} />
    </Tabs>
  </div>
}

function AliasTable({ kind, refresh }: { kind: AliasKind; refresh: number }) {
  const [row, setRow] = useState<CatalogueRow>()
  const [alias, setAlias] = useState('')
  const [query, setQuery] = useState('')
  const [local, setLocal] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const restoreFocus = useRef<string | null>(null)
  const catalogue = useCatalogue(kind, refresh + local)
  const needle = query.trim().toLowerCase()
  const rows = catalogue.items.filter(item => (item.name + ' ' + item.alias).toLowerCase().includes(needle))

  async function save(item: CatalogueRow, value: string) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await api('/admin/aliases/' + kind, 'PUT', { id: item.id, name: item.name, alias: value })
      if (row?.id === item.id || restoreFocus.current === item.id) restoreFocus.current = item.id
      setRow(undefined)
      setLocal(value => value + 1)
    } catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }

  return <div className="admin-view">
    <div className="toolbar"><SearchBox value={query} onChange={value => {
      setQuery(value)
      if (!busy) setRow(undefined)
    }} label={'Search ' + kind} /></div>
    {(error || catalogue.error) && <Notice error>{error || catalogue.error}</Notice>}
    <CatalogueTable label={kind + ' labels'} columns={['BCS', 'Alias']} rows={rows}
      empty={catalogue.loading ? 'Loading catalogue…' : 'No matching entries.'} render={item => <>
        <td title={item.name}>{item.name}</td>
        <td><div className="alias-cell">
          {row?.id === item.id && row.name === item.name ?
            <input type="text" aria-label={'Alias for ' + item.name} value={alias} maxLength={80} autoFocus readOnly={busy}
              onChange={event => setAlias(event.target.value)} onBlur={() => { if (!busy) setRow(undefined) }}
              onKeyDown={event => {
                if (event.nativeEvent.isComposing || busy) return
                if (event.key === 'Enter') { event.preventDefault(); void save(item, alias) }
                if (event.key === 'Escape') { restoreFocus.current = item.id; setRow(undefined) }
              }} /> :
            <button type="button" className="alias-link" aria-label={'Edit alias for ' + item.name} title={item.alias || undefined}
              ref={button => {
                if (button && !busy && restoreFocus.current === item.id) {
                  restoreFocus.current = null
                  button.focus({ preventScroll: true })
                }
              }}
              disabled={busy} onClick={() => { setError(''); setAlias(item.alias); setRow(item) }}>
              <span className={item.alias ? undefined : 'empty-alias'}>{item.alias || '—'}</span>
            </button>}
          {item.alias && <button type="button" className="alias-clear" aria-label={'Clear alias for ' + item.name}
            title="Clear alias" disabled={busy} onClick={() => {
              restoreFocus.current = item.id
              void save(item, '')
            }}><X size={13} aria-hidden="true" /></button>}
        </div></td>
      </>} />
  </div>
}
