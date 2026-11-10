import type { Item, Kind } from '../shared/model.ts'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}
export async function api<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api' + path, {
    method, signal, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })
  const data = await response.json()
  if (!response.ok) throw new ApiError(response.status, data.error ?? 'Request failed.')
  return data as T
}
export type CatalogueRow = Item & { alias: string }
export type CataloguePage = { items: CatalogueRow[]; total: number }
export function catalogue(kind: Kind, q: string, page: number, signal?: AbortSignal) {
  return api<CataloguePage>('/admin/catalogue/' + kind + '?' + new URLSearchParams({ q, page: String(page) }), 'GET', undefined, signal)
}

