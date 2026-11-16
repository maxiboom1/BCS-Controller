import type { ServerResponse } from 'node:http'
import type { FastifyReply } from 'fastify'
import type { ProtocolDirection, ProtocolPacket } from '../shared/model.ts'

const BATCH_MS = 100
const BATCH_BYTES = 128 * 1024
const MAX_BACKLOG = 4 * 1024 * 1024

function escapeWire(packet: Buffer) {
  return packet.toString('latin1').replace(/[\x00-\x1f\x7f-\xff\\]/g, char => {
    if (char === '\t') return '\\t'
    if (char === '\\') return '\\\\'
    return '\\x' + char.charCodeAt(0).toString(16).padStart(2, '0')
  })
}

export function protocolStream(authorized: (session: string) => boolean) {
  const clients = new Map<ServerResponse, string>()
  let nextId = 0
  let batch: ProtocolPacket[] = []
  let bytes = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  function send(stream: ServerResponse, session: string, message: string, length: number) {
    if (stream.destroyed || stream.writableEnded) return
    if (!authorized(session)) {
      stream.end('event: expired\ndata: null\n\n')
    } else if (stream.writableLength + length > MAX_BACKLOG) {
      stream.destroy()
    } else {
      stream.write(message)
    }
  }

  function flush() {
    clearTimeout(timer)
    timer = undefined
    const packets = batch
    batch = []
    bytes = 0
    if (!packets.length || !clients.size) return
    const message = 'event: packets\ndata: ' + JSON.stringify(packets) + '\n\n'
    const length = Buffer.byteLength(message)
    for (const [stream, session] of clients) send(stream, session, message, length)
  }

  return {
    capture(direction: ProtocolDirection, packet: Buffer) {
      if (!clients.size) return
      batch.push({ id: ++nextId, at: Date.now(), direction, wire: escapeWire(packet) })
      bytes += packet.length
      if (bytes >= BATCH_BYTES) flush()
      else timer ??= setTimeout(flush, BATCH_MS)
    },
    connect(reply: FastifyReply, session: string) {
      const stream = reply.raw
      reply.hijack()
      stream.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store',
        Connection: 'keep-alive', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' })
      const heartbeat = ': heartbeat\n\n'
      clients.set(stream, session)
      stream.write(': connected\n\n')
      const interval = setInterval(() => send(stream, session, heartbeat, heartbeat.length), 10_000)
      stream.once('close', () => {
        clearInterval(interval)
        clients.delete(stream)
      })
    },
    close() {
      for (const stream of clients.keys()) stream.destroy()
      clients.clear()
      flush()
    },
  }
}
