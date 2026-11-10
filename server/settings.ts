import { isIP } from 'node:net'
import { z } from 'zod'
import type { ControllerSettings } from '../shared/model.ts'

export const DEFAULT_SETTINGS: ControllerSettings = {
  bcsHost: '10.10.10.156', bcsPort: 12345, pollIntervalMs: 1000, webPort: 8443, idleMinutes: 0,
}

const port = z.number().int().min(1).max(65535)
export const settingsInput = z.object({
  bcsHost: z.string().trim().refine(value => isIP(value) !== 0, 'Enter a valid BCS IP address.'),
  bcsPort: port,
  pollIntervalMs: z.number().int().min(1000).max(60_000),
  webPort: port,
  idleMinutes: z.number().int().min(0).max(720),
})

export function endpointAddress(host: string, port: number) {
  return (isIP(host) === 6 ? `[${host}]` : host) + ':' + port
}
