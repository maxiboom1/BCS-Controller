import { randomUUID } from 'node:crypto'
import type { OnlineSession, User } from '../shared/model.ts'

function browserLabel(agent: string) {
  const browsers = [
    ['Edge', /\b(?:Edg|EdgiOS|EdgA|Edge)\/([\d.]+)/], ['Opera', /\bOPR\/([\d.]+)/],
    ['Samsung Internet', /\bSamsungBrowser\/([\d.]+)/], ['Firefox', /\b(?:Firefox|FxiOS)\/([\d.]+)/],
    ['Chrome', /\b(?:Chrome|CriOS)\/([\d.]+)/], ['Safari', /\bVersion\/([\d.]+).*\bSafari\//],
  ] as const
  for (const [name, pattern] of browsers) {
    const version = agent.match(pattern)?.[1]
    if (version) return `${name} ${version}`
  }
  return 'Unknown browser'
}

export class Presence {
  private clients = new Map<string, { id: string; ip: string; browser: string; streams: number }>()

  connect(session: string, ip: string, agent: string) {
    const client = this.clients.get(session) ?? { id: randomUUID(), ip, browser: browserLabel(agent), streams: 0 }
    client.streams++
    this.clients.set(session, client)
    return () => { if (--client.streams === 0) this.clients.delete(session) }
  }

  session(id: string) {
    for (const [session, client] of this.clients) if (client.id === id) return session
  }

  list(current: string, account: (token: string) => User | undefined, activity: (token: string) => number | undefined) {
    const rows: OnlineSession[] = []
    for (const [session, { id, ip, browser }] of this.clients) {
      const user = account(session)
      if (user) rows.push({ id, ip, browser, username: user.username, lastActivityAt: activity(session) ?? Date.now(), current: session === current })
    }
    return rows.sort((a, b) => a.username.localeCompare(b.username) || b.lastActivityAt - a.lastActivityAt)
  }
}
