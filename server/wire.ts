import type { Catalogue, Crosspoints, Item } from '../shared/model.ts'

export type Frame = { sequence: string; fields: string[] }
const ascii = /^[\x20-\x7e]*$/
const checksum = (body: Buffer) => (-body.reduce((sum, byte) => sum + byte, 0) & 255)
  .toString(16).padStart(2, '0').toUpperCase()

export function encode(fields: string[], sequence = '0') {
  if (!/^[0-9]$/.test(sequence) || !/^[A-Za-z]{2}$/.test(fields[0] ?? '') || fields.some(field => !ascii.test(field))) {
    throw new Error('Invalid GVG command or field')
  }
  const body = Buffer.from('N' + sequence + fields.join('\t'), 'ascii')
  return Buffer.concat([Buffer.from([1]), body, Buffer.from(checksum(body), 'ascii'), Buffer.from([4])])
}

export class Decoder {
  private buffer = Buffer.alloc(0)
  get pending() { return this.buffer.length > 0 }

  push(chunk: Buffer): Frame[] {
    this.buffer = Buffer.concat([this.buffer, chunk])
    const frames: Frame[] = []
    let end: number
    while ((end = this.buffer.indexOf(4)) >= 0) {
      const packet = this.buffer.subarray(0, end)
      this.buffer = this.buffer.subarray(end + 1)
      const body = packet.subarray(1, -2)
      if (packet[0] !== 1 || body[0] !== 78 || body.length < 4 || body.some(byte => byte > 127) ||
          !/^[0-9]$/.test(String.fromCharCode(body[1])) ||
          checksum(body) !== packet.subarray(-2).toString('ascii').toUpperCase()) {
        throw new Error('Invalid GVG frame or checksum')
      }
      frames.push({ sequence: String.fromCharCode(body[1]), fields: body.subarray(2).toString('ascii').split('\t') })
    }
    if (this.buffer.length > 4096) throw new Error('Unterminated GVG frame')
    return frames
  }
}

export function hex(value: string, width: number) {
  if (!new RegExp('^[0-9A-Fa-f]{' + width + '}$').test(value)) throw new Error('Invalid GVG hexadecimal field')
  return value.toUpperCase()
}

export function catalogueRows(frames: Frame[], kind: string, width: number): string[][] {
  if (!frames.length || frames.at(-1)?.sequence !== '0') throw new Error('Incomplete GVG catalogue')
  return frames.flatMap(({ fields }) => {
    const count = entryCount(fields[2])
    const body = fields.slice(3)
    if (fields[0] !== 'NQ' || fields[1] !== kind || body.length < count * width ||
        body.slice(count * width).some(Boolean)) throw new Error('Invalid GVG catalogue row')
    return Array.from({ length: count }, (_, i) => body.slice(i * width, (i + 1) * width))
  })
}

function entryCount(value: string) {
  if (!/^\d{1,3}$/.test(value)) throw new Error('Invalid GVG group count')
  return Number(value)
}

export function readCatalogue(frames: Frame[], kind: 'S' | 'D' | 'L' | 'V'): Item[] {
  const width = kind === 'V' ? 1 : kind === 'L' ? 3 : 4
  const ids = new Set<string>()
  return catalogueRows(frames, kind, width).map(([name, rawId]) => {
    const id = kind === 'V' ? name : hex(rawId, kind === 'L' ? 2 : 4)
    if (ids.has(id) || (kind !== 'S' && !name.trim()) || (kind === 'L' && parseInt(id, 16) > 31)) {
      throw new Error('Invalid or duplicate GVG catalogue item')
    }
    ids.add(id)
    return { id, name, label: name }
  })
}

export function byName(items: Item[]) {
  const result = new Map<string, string>()
  for (const item of items) {
    if (!item.name.trim()) continue
    if (result.has(item.name)) throw new Error('Ambiguous GVG name: ' + item.name)
    result.set(item.name, item.id)
  }
  return result
}

export function decodeStatus(frames: Frame[], catalogue: Catalogue, destinationId?: string) {
  const destinations = byName(catalogue.destinations)
  const sources = byName(catalogue.sources)
  const levelIds = new Set(catalogue.levels.map(item => item.id))
  const sourceIds = new Set(catalogue.sources.filter(item => item.name.trim()).map(item => item.id))
  const completed = new Map<string, Crosspoints>()
  const pending = new Map<string, Crosspoints>()
  for (const { sequence, fields } of frames) {
    const id = destinationId ? hex(fields[1], 4) : destinations.get(fields[1])
    if (!id || fields[0] !== (destinationId ? 'jQ' : 'DQ') ||
        (destinationId && id !== destinationId) || completed.has(id)) throw new Error('Unexpected GVG destination status')
    const crosspoints = pending.get(id) ?? {}
    const count = entryCount(fields[2])
    for (let group = 0; group < count; group++) {
      const [protect, chop, source, rawMask] = fields.slice(3 + group * 6, 7 + group * 6)
      if (!/^[NP]$/.test(protect) || !/^[NC]$/.test(chop)) throw new Error('Invalid GVG status flags')
      const sourceId = source === 'NO_XPT' || (destinationId && source.toUpperCase() === 'FFFE') ? null
        : destinationId ? hex(source, 4) : sources.get(source)
      if (sourceId === undefined || (sourceId !== null && !sourceIds.has(sourceId))) throw new Error('Unknown GVG source: ' + source)
      const mask = parseInt(hex(rawMask, 8), 16)
      for (let bit = 0; bit < 32; bit++) {
        if (!(mask & (1 << bit))) continue
        const levelId = bit.toString(16).padStart(2, '0').toUpperCase()
        if (!levelIds.has(levelId) || crosspoints[levelId]) throw new Error('Unknown or overlapping GVG level groups')
        crosspoints[levelId] = { sourceId, protected: protect === 'P', chopping: chop === 'C' }
      }
    }
    if (fields.slice(3 + count * 6).some(Boolean)) throw new Error('Unexpected GVG status fields')
    if (sequence === '0') {
      pending.delete(id)
      completed.set(id, crosspoints)
    } else pending.set(id, crosspoints)
  }
  if (pending.size) throw new Error('Incomplete GVG destination sequence')
  return completed
}

export function levelMask(ids: string[]) {
  return ids.reduce((mask, id) => (mask | (1 << parseInt(id, 16))) >>> 0, 0)
    .toString(16).padStart(8, '0').toUpperCase()
}

