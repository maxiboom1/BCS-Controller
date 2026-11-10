import { readFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
const [major, minor, patch] = version.split('.')
export const release = `${major}.${minor}.${patch.padStart(2, '0')}`

export function consoleLogger(enabled: boolean) {
  return (message: string, level: 'INFO' | 'WARN' | 'ERROR' = 'INFO') => {
    if (!enabled) return
    const timestamp = new Date().toLocaleString('sv-SE', { hour12: false })
    const line = `[${timestamp}] ${level} ${message.replace(/[\x00-\x1f\x7f]/g, ' ')}`
    if (level === 'ERROR') console.error(line)
    else console.log(line)
  }
}
