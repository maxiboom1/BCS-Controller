export type MonitorRange = 'all' | 'today' | 'yesterday' | 'last'
export type TimeBounds = { from?: number; to?: number }

const HOUR = 3_600_000

function midnight(now: Date, dayOffset: number) {
  const date = new Date(now)
  date.setDate(date.getDate() + dayOffset)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export function monitorBounds(range: MonitorRange, hours: number, now = new Date()): TimeBounds {
  if (range === 'last') return { from: now.getTime() - hours * HOUR }
  if (range === 'today') return { from: midnight(now, 0), to: midnight(now, 1) }
  if (range === 'yesterday') return { from: midnight(now, -1), to: midnight(now, 0) }
  return {}
}

export function monitorRefreshDelay(range: MonitorRange, hours: number, oldest: number | undefined, now = new Date()) {
  if (range === 'all' || (range === 'last' && oldest === undefined)) return undefined
  const boundary = range === 'last' ? oldest! + hours * HOUR + 1 : midnight(now, 1)
  return Math.max(1, Math.min(2_147_000_000, boundary - now.getTime()))
}
