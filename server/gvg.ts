import { createConnection } from 'node:net'
import type { Socket } from 'node:net'
import type { Catalogue } from '../shared/model.ts'
import { byName, Decoder, decodeStatus, encode, readCatalogue } from './wire.ts'
import type { Frame } from './wire.ts'

type Pending = { frames: Frame[]; accept: (frame: Frame) => boolean; done: (frames: Frame[]) => boolean; finish: (error?: Error) => void }

export class Gvg {
  private pending: Pending | null = null
  private decoder = new Decoder()
  private error: Error | undefined
  onClose = (_error: Error) => {}
  private socket: Socket

  private constructor(socket: Socket) {
    this.socket = socket
    socket.setNoDelay(true)
    socket.setKeepAlive(true, 10_000)
    socket.on('data', (chunk: Buffer) => {
      try {
        for (const frame of this.decoder.push(chunk)) {
          const pending = this.pending
          if (!pending || !pending.accept(frame)) throw new Error('Unexpected GVG reply: ' + frame.fields[0])
          pending.frames.push(frame)
          if (pending.frames.length > 20_000) throw new Error('GVG reply exceeded frame limit')
          if (pending.done(pending.frames)) pending.finish()
        }
      } catch (error) {
        socket.destroy(error as Error)
      }
    })
    socket.on('error', error => { this.error = error; this.pending?.finish(error) })
    socket.on('close', () => {
      const error = this.error ?? new Error('GVG connection closed')
      this.pending?.finish(error)
      this.onClose(error)
    })
  }

  static async open(host: string, port: number, signal: AbortSignal) {
    signal.throwIfAborted()
    const socket = createConnection({ host, port })
    const connection = new Gvg(socket)
    const abort = () => socket.destroy(new Error('GVG connection cancelled'))
    signal.addEventListener('abort', abort, { once: true })
    socket.once('close', () => signal.removeEventListener('abort', abort))
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => socket.destroy(new Error('GVG connect timeout')), 4000)
        socket.once('connect', () => { clearTimeout(timer); resolve() })
        socket.once('close', () => { clearTimeout(timer); reject(connection.error ?? new Error('GVG connect failed')) })
      })
      return connection
    } catch (error) {
      socket.destroy()
      throw error
    }
  }

  get closed() { return this.socket.destroyed }
  close() { this.socket.destroy() }

  private request(fields: string[], accept: Pending['accept'], done: Pending['done'], ms: number, silence = false) {
    if (this.closed || this.pending) throw new Error('GVG socket unavailable or busy')
    const packet = encode(fields)
    return new Promise<Frame[]>((resolve, reject) => {
      const frames: Frame[] = []
      const finish = (error?: Error) => {
        clearTimeout(timer)
        this.pending = null
        if (error) reject(error)
        else resolve(frames)
      }
      const timer = setTimeout(() => {
        if (silence && !this.decoder.pending && frames.every(frame => frame.fields[0] === 'DQ') ) finish()
        else this.socket.destroy(new Error('GVG timeout or incomplete reply for ' + fields.join(',')))
      }, ms)
      this.pending = { frames, accept, done, finish }
      this.socket.write(packet, error => { if (error) this.socket.destroy(error) })
    })
  }

  private async list(query: string, reply: 'S' | 'D' | 'L' | 'V', optional = false) {
    const frames = await this.request(['QN', query], frame => frame.fields[0] === 'NQ' && frame.fields[1] === reply,
      items => items.at(-1)?.sequence === '0', optional ? 1500 : 8000, optional)
    return frames.length || !optional ? readCatalogue(frames, reply) : []
  }

  async catalogues(): Promise<Catalogue> {
    const sources = await this.list('IS', 'S')
    const destinations = await this.list('ID', 'D')
    const levels = await this.list('L', 'L')
    if (!sources.length || !destinations.length || !levels.length) throw new Error('Empty required GVG catalogue')
    byName(sources)
    byName(destinations)
    const salvos = await this.list('V', 'V', true)
    return { sources, destinations, levels, salvos }
  }

  async snapshot(catalogue: Catalogue) {
    const names = new Set(catalogue.destinations.map(item => item.name))
    const complete = new Set<string>()
    const frames = await this.request(['QD'], frame => frame.fields[0] === 'DQ' && names.has(frame.fields[1]),
      items => {
        const last = items.at(-1)!
        if (last.sequence === '0') complete.add(last.fields[1])
        return complete.size === names.size
      }, 8000)
    const routes = decodeStatus(frames, catalogue)
    if (routes.size !== names.size) throw new Error('Incomplete GVG startup snapshot')
    return routes
  }

  async poll(catalogue: Catalogue) {
    const frames = await this.request(['QD'], frame => frame.fields[0] === 'DQ', () => false, 1000, true)
    return decodeStatus(frames, catalogue)
  }

  async read(catalogue: Catalogue, destinationId: string) {
    const frames = await this.request(['Qj', destinationId], frame => frame.fields[0] === 'jQ',
      items => items.at(-1)?.sequence === '0', 2000)
    return decodeStatus(frames, catalogue, destinationId).get(destinationId)!
  }

  async health() {
    await this.request(['QT'], frame => frame.fields[0] === 'ST' && /^\d{14}$/.test(frame.fields[1]),
      frames => frames.at(-1)?.sequence === '0', 2000)
  }

  async verifyEchoOff() {
    const frames = await this.request(['BK', 'E'], frame => frame.fields[0] === 'KB' && frame.fields[1] === 'E',
      frames => frames.at(-1)?.sequence === '0', 2000)
    if (frames.at(-1)?.fields[2] !== 'OFF') throw new Error('This GVG adapter requires the verified L4 Echo OFF profile.')
  }

  async take(destination: string, source: string, bitmap?: string) {
    if (this.pending || this.closed) throw new Error('GVG socket unavailable')
    const packet = encode(bitmap === undefined ? ['TD', destination, source] : ['TD', destination, source, bitmap])
    await new Promise<void>((resolve, reject) => this.socket.write(packet, error => error ? reject(error) : resolve()))
  }
}

