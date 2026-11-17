import { z } from 'zod'
import type { Catalogue, Item, MonitorPage, MonitorRow } from '../shared/model.ts'
import type { Store } from './db.ts'
import type { RouteObservation } from './router.ts'

const PAGE_SIZE = 100
const timestamp = z.number().int().nonnegative().max(8_640_000_000_000_000)
const millis = z.string().regex(/^\d+$/).transform(Number).pipe(timestamp)
export const monitorQuery = z.object({
  q: z.string().trim().default(''),
  from: millis.optional(),
  to: millis.optional(),
  before: z.string().regex(/^\d+:\d+:\d+$/).transform(value => value.split(':').map(Number))
    .pipe(z.tuple([timestamp, z.number().int().positive(), z.number().int().positive()])).optional(),
}).refine(value => value.from === undefined || value.to === undefined || value.from < value.to, 'Invalid time range.')

type Entry = Omit<MonitorRow, 'id'> & { actionKey: string | null; sourceName: string; destinationName: string }

export function monitorHistory(db: Store) {
  db.sql.transaction(() => {
    db.sql.exec(`
      CREATE TABLE IF NOT EXISTS route_history (
        id INTEGER PRIMARY KEY, at INTEGER NOT NULL, user TEXT NOT NULL, userIp TEXT,
        event TEXT NOT NULL CHECK (event IN ('Route', 'Salvo')), panelName TEXT,
        destination TEXT NOT NULL, source TEXT NOT NULL, destinationName TEXT NOT NULL, sourceName TEXT NOT NULL,
        actionKey TEXT UNIQUE, search_text TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS route_history_time ON route_history (at DESC, id DESC);
      CREATE VIRTUAL TABLE IF NOT EXISTS route_history_search USING fts5(
        search_text, content='route_history', content_rowid='id', tokenize='trigram'
      );
    `)
  })()
  const insert = db.sql.prepare(`
    INSERT INTO route_history (at, user, userIp, event, panelName, destination, source, destinationName, sourceName, actionKey, search_text)
    VALUES (@at, @user, @userIp, @event, @panelName, @destination, @source, @destinationName, @sourceName, @actionKey, @searchText)
    ON CONFLICT(actionKey) DO NOTHING
  `)
  const index = db.sql.prepare('INSERT INTO route_history_search (rowid, search_text) VALUES (?, ?)')
  const newest = db.sql.prepare('SELECT coalesce(max(id), 0) FROM route_history').pluck()
  const head = () => newest.get() as number
  const append = db.sql.transaction((rows: Entry[]) => {
    let lastId = 0
    for (const row of rows) {
      const searchText = [row.user, row.userIp ?? 'N/A', row.event, row.panelName ?? 'N/A',
        row.destination, row.source, row.destinationName, row.sourceName].join('\n').toLowerCase()
      const inserted = insert.run({ ...row, searchText })
      if (inserted.changes) {
        lastId = Number(inserted.lastInsertRowid)
        index.run(lastId, searchText)
      }
    }
    return lastId
  })

  let indexedCatalogue: Catalogue | undefined
  let sourceItems = new Map<string, Item>()
  let destinationItems = new Map<string, Item>()
  function label(kind: 'sources' | 'destinations', item: Item | undefined, fallback: string) {
    const name = item?.name ?? fallback
    return { name, display: item ? db.alias(kind, item) || name : name }
  }

  function record(observations: RouteObservation[], catalogue: Catalogue) {
    if (indexedCatalogue !== catalogue) {
      indexedCatalogue = catalogue
      sourceItems = new Map(catalogue.sources.map(item => [item.id, item]))
      destinationItems = new Map(catalogue.destinations.map(item => [item.id, item]))
    }
    const rows: Entry[] = []
    for (const { at, destinationId, levels, take } of observations) {
      const destination = label('destinations', destinationItems.get(destinationId), destinationId)
      const externalSources = new Set<string | null>()
      let appChange = false
      for (const level of levels) {
        if (take && level.sourceId === take.sourceId && take.levelIds.has(level.id) && !level.chopping) appChange = true
        else externalSources.add(level.sourceId)
      }
      function entry(sourceId: string | null, actor?: RouteObservation['take']): Entry {
        const source = label('sources', sourceId === null ? undefined : sourceItems.get(sourceId), sourceId ?? 'No crosspoint')
        return { at, event: 'Route', user: actor?.username ?? 'External', userIp: actor?.ip ?? null,
          panelName: actor?.panelName ?? null, actionKey: actor?.actionKey ?? null,
          destination: destination.display, destinationName: destination.name, source: source.display, sourceName: source.name }
      }
      if (appChange && take) rows.push(entry(take.sourceId, take))
      for (const sourceId of externalSources) rows.push(entry(sourceId))
    }
    return append(rows)
  }

  function page(input: z.output<typeof monitorQuery>): MonitorPage {
    const conditions: string[] = []
    const latest = head()
    const params: Record<string, string | number> = { limit: PAGE_SIZE + 1 }
    if (input.from !== undefined) { conditions.push('r.at >= @from'); params.from = input.from }
    if (input.to !== undefined) { conditions.push('r.at < @to'); params.to = input.to }
    if (input.before) {
      conditions.push('(r.at, r.id) < (@beforeAt, @beforeId)', 'r.id <= @historyHead')
      const [at, id, historyHead] = input.before
      params.beforeAt = at
      params.beforeId = id
      params.historyHead = historyHead
    }
    const query = input.q.toLowerCase()
    if ([...query].length >= 3 && !query.includes('\0')) {
      conditions.push('r.id IN (SELECT rowid FROM route_history_search WHERE route_history_search MATCH @query)')
      params.query = '"' + query.replaceAll('"', '""') + '"'
    } else if (query) {
      conditions.push('instr(r.search_text, @query) > 0')
      params.query = query
    }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''
    const rows = db.sql.prepare(`
      SELECT r.id, r.at, r.user, r.userIp, r.event, r.panelName, r.destination, r.source
      FROM route_history AS r ${where} ORDER BY r.at DESC, r.id DESC LIMIT @limit
    `).all(params) as MonitorRow[]
    const hasOlder = rows.length > PAGE_SIZE
    if (hasOlder) rows.pop()
    const last = rows.at(-1)
    return { rows, nextCursor: hasOlder && last ? `${last.at}:${last.id}:${input.before?.[2] ?? latest}` : null, head: latest }
  }

  return { record, page, head }
}
