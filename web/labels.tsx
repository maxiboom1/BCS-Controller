import { useState } from 'react'
import type { FormEvent } from 'react'
import { api } from './api.ts'
import type { CatalogueRow } from './api.ts'
import { CatalogueTable } from './catalogueTable.tsx'
import { Notice, SearchBox, Tabs, useCatalogue } from './components.tsx'

type AliasKind = 'sources' | 'destinations' | 'salvos'
const labelTabs = ['Sources', 'Destinations'] as const

export function LabelsTab({ refresh }: { refresh: number }) {
  const [tab, setTab] = useState<(typeof labelTabs)[number]>('Sources')
  return <Tabs label="Labels" tabs={labelTabs} active={tab} change={setTab}>
    <AliasTable key={tab} kind={tab === 'Sources' ? 'sources' : 'destinations'} refresh={refresh} />
  </Tabs>
}

export function AliasTable({ kind, refresh }: { kind: AliasKind; refresh: number }) {
  const [row, setRow] = useState<CatalogueRow>()
  const [alias, setAlias] = useState('')
  const [query, setQuery] = useState('')
  const [local, setLocal] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const catalogue = useCatalogue(kind, refresh + local)
  const needle = query.trim().toLowerCase()
  const rows = catalogue.items.filter(item => (item.name + ' ' + item.alias).toLowerCase().includes(needle))

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!row) return
    setBusy(true)
    setError('')
    try {
      await api('/admin/aliases/' + kind, 'PUT', { id: row.id, name: row.name, alias })
      setRow(undefined)
      setLocal(value => value + 1)
    } catch (err) { setError((err as Error).message) }
    finally { setBusy(false) }
  }

  return <div className="surface">
    <div className="toolbar"><SearchBox value={query} onChange={setQuery} label={'Search ' + kind} /></div>
    {row && <form className="alias-editor toolbar" onSubmit={save}>
      <label>{row.name}<input key={row.id} aria-label={'Alias for ' + row.name} value={alias} maxLength={80} autoFocus
        onChange={event => setAlias(event.target.value)} disabled={busy} /></label>
      <button className="primary" disabled={busy}>Save</button>
      <button type="button" disabled={busy} onClick={() => { setRow(undefined); setError('') }}>Cancel</button>
    </form>}
    {(error || catalogue.error) && <Notice error>{error || catalogue.error}</Notice>}
    <CatalogueTable label={kind + ' labels'} columns={['BCS', 'Alias']} rows={rows}
      empty={catalogue.loading ? 'Loading catalogue…' : 'No matching entries.'} render={item => <>
        <td title={item.name}>{item.name}</td>
        <td><button type="button" className="alias-link" aria-label={'Edit alias for ' + item.name} title={item.alias || undefined}
          disabled={busy} onClick={() => { setError(''); setAlias(item.alias); setRow(item) }}>
          <span>{item.alias || 'Add alias'}</span></button></td>
      </>} />
  </div>
}
