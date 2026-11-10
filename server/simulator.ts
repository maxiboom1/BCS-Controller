import { createServer } from 'node:net'
import type { Socket } from 'node:net'
import { Decoder, encode } from './wire.ts'

const id = (index: number, size = 4) => index.toString(16).padStart(size, '0').toUpperCase()
export const simulatedSources = ['CAM 1', 'CAM 2', 'CAM 3', 'PLAYBACK', 'GRAPHICS', 'STUDIO WIDE', 'BLACK', 'TEST BARS']
export const simulatedDestinations = ['PROGRAM', 'PREVIEW', 'LOBBY MON', 'STUDIO MON', 'RECORD A', 'RECORD B', 'MULTIVIEW', 'SPARE']
const levels = ['VID', ...Array.from({ length: 16 }, (_, i) => 'AUD ' + (i + 1))]

export async function startSimulator({ sources = simulatedSources, destinations = simulatedDestinations } = {}) {
  const routes = destinations.map((_, i) => levels.map((_, l) =>
    i === 7 ? null : i === 3 && l > 4 ? 4 : i % sources.length))
  const sockets = new Set<Socket>()
  const controls = { takes: 0, partial: false, dropAfterTake: false }
  const server = createServer(socket => {
    sockets.add(socket)
    socket.setNoDelay(true)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => {})
    const decoder = new Decoder()
    const reported = new Map<number, string>()

    function sendCatalogue(kind: string, rows: string[][]) {
      const chunks = Array.from({ length: Math.ceil(rows.length / 4) }, (_, i) => rows.slice(i * 4, i * 4 + 4))
      const frames = chunks.map((chunk, i) =>
        encode(['NQ', kind, String(chunk.length), ...chunk.flat()], i === chunks.length - 1 ? '0' : '9'))
      // Split a frame across writes and combine the remaining frames.
      const output = Buffer.concat(frames)
      socket.write(output.subarray(0, 4))
      socket.write(output.subarray(4))
    }

    function status(index: number, indexed: boolean) {
      const groups = new Map<number | null, number>()
      routes[index].forEach((source, level) => {
        if (source !== null || indexed) groups.set(source, (groups.get(source) ?? 0) | (1 << level))
      })
      return encode([indexed ? 'jQ' : 'DQ', indexed ? id(index) : destinations[index], String(groups.size),
        ...[...groups].flatMap(([source, mask]) => ['N', 'N',
          source === null ? 'FFFE' : indexed ? id(source) : sources[source], id(mask, 8), '', ''])])
    }

    socket.on('data', (chunk: Buffer) => {
      try {
        for (const { fields: [command, a, b, mask] } of decoder.push(chunk)) {
          if (command === 'QN') {
            if (a === 'IS') sendCatalogue('S', sources.map((name, i) => [name, id(i), 'N', 'FFFFFFFF']))
            if (a === 'ID') sendCatalogue('D', destinations.map((name, i) => [name, id(i), 'N', 'FFFFFFFF']))
            if (a === 'L') sendCatalogue('L', levels.map((name, i) => [name, id(i, 2), 'N']))
            if (a === 'V') sendCatalogue('V', [['STUDIO-A'], ['STUDIO-B']])
          } else if (command === 'QD') {
            routes.forEach((route, index) => {
              const value = JSON.stringify(route)
              if (reported.get(index) !== value) {
                reported.set(index, value)
                socket.write(status(index, false))
              }
            })
          } else if (command === 'Qj' && routes[parseInt(a, 16)]) {
            socket.write(status(parseInt(a, 16), true))
          } else if (command === 'QT') {
            socket.write(encode(['ST', new Date().toISOString().replace(/\D/g, '').slice(0, 14)]))
          } else if (command === 'BK' && a === 'E') {
            socket.write(encode(['KB', 'E', 'OFF']))
          } else if (command === 'TD') {
            const dest = destinations.indexOf(a)
            const source = sources.indexOf(b)
            if (dest < 0 || source < 0) continue
            controls.takes++
            const bitmap = mask === undefined ? 0x1ffff : parseInt(mask, 16)
            routes[dest] = routes[dest].map((old, level) =>
              (bitmap & (1 << level)) && !(controls.partial && level === 0) ? source : old)
            if (controls.dropAfterTake) socket.destroy()
          } else {
            socket.destroy()
          }
        }
      } catch { socket.destroy() }
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Simulator did not bind')
  return {
    host: '127.0.0.1', port: address.port, controls,
    externalTake(destination: number, source: number, level?: number) {
      routes[destination] = routes[destination].map((old, i) => level === undefined || i === level ? source : old)
    },
    close() {
      for (const socket of sockets) socket.destroy()
      return new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    },
  }
}

