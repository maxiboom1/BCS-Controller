import { resolve } from 'node:path'
import type { RouterStatus } from '../shared/model.ts'
import { DEFAULT_SETTINGS } from './settings.ts'

export function configuration(env = process.env) {
  const mode = env.BCS_MODE ?? 'live'
  if (mode !== 'simulator' && mode !== 'live-readonly' && mode !== 'live') throw new Error('Invalid BCS_MODE')
  const base = env.BCS_DATA_DIR ?? (mode === 'simulator' ? 'data/simulator' : 'data/live')
  return {
    mode: mode as RouterStatus['mode'], database: resolve(base, 'controller.sqlite'),
    bcsHost: env.BCS_HOST ?? DEFAULT_SETTINGS.bcsHost,
    bcsPort: port(env.BCS_PORT ?? String(DEFAULT_SETTINGS.bcsPort)),
    selectedLevels: env.BCS_ENABLE_SELECTED_LEVELS === 'yes',
    host: env.WEB_HOST ?? '127.0.0.1', port: port(env.WEB_PORT ?? (mode === 'simulator' ? '8088' : String(DEFAULT_SETTINGS.webPort))),
  }
}

function port(value: string) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error('Invalid port: ' + value)
  return parsed
}

