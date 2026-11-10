import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import type { Binding, Catalogue, ControllerSettings, Kind, Panel, PanelInput, TakeResult, User } from '../shared/model.ts'

type UserRow = { id: string; username: string; password: string; role: User['role']; enabled: number }
type ActionRow = { fingerprint: string; result: string | null; attempted: number }

export class Store {
  sql: Database.Database

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.sql = new Database(path)
    this.sql.pragma('journal_mode = WAL')
    this.sql.pragma('foreign_keys = ON')
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password TEXT NOT NULL, role TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS session_activity (
        token TEXT PRIMARY KEY REFERENCES sessions(token) ON DELETE CASCADE, last_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS panels (
        id TEXT PRIMARY KEY, config TEXT NOT NULL, version INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS assignments (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        panel_id TEXT NOT NULL REFERENCES panels(id) ON DELETE CASCADE, PRIMARY KEY (user_id, panel_id)
      );
      CREATE TABLE IF NOT EXISTS aliases (
        kind TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, label TEXT NOT NULL, PRIMARY KEY (kind, id)
      );
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS takes (
        user_id TEXT NOT NULL REFERENCES users(id), id TEXT NOT NULL, fingerprint TEXT NOT NULL,
        attempted INTEGER NOT NULL DEFAULT 0, result TEXT, created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, id)
      );
    `)
    this.sql.prepare('INSERT OR IGNORE INTO session_activity SELECT token, ? FROM sessions WHERE expires > ?')
      .run(Date.now(), Date.now())
  }

  recoverTakes() {
    this.sql.prepare('UPDATE takes SET result = CASE WHEN attempted = 1 THEN ? ELSE ? END WHERE result IS NULL').run(
      JSON.stringify({ outcome: 'uncertain', message: 'Server restarted during TAKE. Check current routing.' }),
      JSON.stringify({ outcome: 'blocked', message: 'Server restarted before TAKE was sent.' }),
    )
  }

  private user(row: UserRow): User {
    const panelIds = (this.sql.prepare('SELECT panel_id FROM assignments WHERE user_id = ? ORDER BY panel_id')
      .all(row.id) as { panel_id: string }[]).map(item => item.panel_id)
    return { id: row.id, username: row.username, role: row.role, enabled: Boolean(row.enabled), panelIds }
  }

  findByUsername(username: string) {
    return this.sql.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined
  }

  findUser(id: string) {
    const row = this.sql.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined
    return row ? this.user(row) : undefined
  }

  users() {
    return (this.sql.prepare('SELECT * FROM users ORDER BY username COLLATE NOCASE').all() as UserRow[])
      .map(row => this.user(row))
  }

  saveUser(input: { username: string; password?: string; enabled: boolean; panelIds: string[] }, id?: string, role: User['role'] = 'operator') {
    return this.sql.transaction(() => {
      const key = id ?? randomUUID()
      if (id) {
        const old = this.findUser(id)
        if (!old || (old.role === 'admin' && !input.enabled)) throw new Error('The administrator must stay enabled')
        this.sql.prepare('UPDATE users SET username = ?, enabled = ?, password = coalesce(?, password) WHERE id = ?')
          .run(input.username, Number(input.enabled), input.password ?? null, id)
        if (input.password || !input.enabled) this.sql.prepare('DELETE FROM sessions WHERE user_id = ?').run(id)
      } else {
        this.sql.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?)').run(key, input.username, input.password!, role, Number(input.enabled))
      }
      this.sql.prepare('DELETE FROM assignments WHERE user_id = ?').run(key)
      const assign = this.sql.prepare('INSERT INTO assignments VALUES (?, ?)')
      for (const panel of new Set(input.panelIds)) assign.run(key, panel)
      return this.findUser(key)!
    })()
  }

  session(token: string, userId: string, expires: number) {
    this.sql.transaction(() => {
      const now = Date.now()
      this.sql.prepare('DELETE FROM sessions WHERE expires <= ?').run(now)
      this.sql.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(token, userId, expires)
      this.sql.prepare('INSERT INTO session_activity VALUES (?, ?)').run(token, now)
    })()
  }
  logout(token: string) { this.sql.prepare('DELETE FROM sessions WHERE token = ?').run(token) }

  sessionUser(token: string, idleMs = 0) {
    const now = Date.now()
    const row = this.sql.prepare(`
      SELECT users.*, session_activity.last_at FROM sessions JOIN users ON users.id = sessions.user_id
      LEFT JOIN session_activity ON sessions.token = session_activity.token
      WHERE sessions.token = ? AND expires > ? AND enabled = 1
    `).get(token, now) as (UserRow & { last_at: number | null }) | undefined
    if (row && idleMs && row.last_at !== null && now - row.last_at >= idleMs) {
      this.logout(token)
      return undefined
    }
    return row ? this.user(row) : undefined
  }

  activity(token: string) {
    return (this.sql.prepare('SELECT last_at FROM session_activity WHERE token = ?').get(token) as { last_at: number } | undefined)?.last_at
  }

  touchSession(token: string) {
    const now = Date.now()
    this.sql.prepare(`INSERT INTO session_activity VALUES (?, ?)
      ON CONFLICT(token) DO UPDATE SET last_at = excluded.last_at WHERE session_activity.last_at <= ?`)
      .run(token, now, now - 2000)
  }

  private panel(row: { id: string; config: string; version: number }): Panel {
    return { ...JSON.parse(row.config) as PanelInput, id: row.id, version: row.version }
  }
  panels() {
    return (this.sql.prepare('SELECT * FROM panels ORDER BY rowid').all() as { id: string; config: string; version: number }[])
      .map(row => this.panel(row))
  }
  findPanel(id: string) {
    const row = this.sql.prepare('SELECT * FROM panels WHERE id = ?').get(id) as Parameters<Store['panel']>[0] | undefined
    return row ? this.panel(row) : undefined
  }
  savePanel(input: PanelInput, id: string = randomUUID(), allLevelBindings?: Binding[]) {
    this.sql.prepare(`
      INSERT INTO panels VALUES (?, ?, 1)
      ON CONFLICT(id) DO UPDATE SET config = excluded.config, version = panels.version + 1
    `).run(id, JSON.stringify({ ...input, allLevelBindings }))
    return this.findPanel(id)!
  }

  alias(kind: Kind, item: Binding) {
    const row = this.sql.prepare('SELECT label FROM aliases WHERE kind = ? AND id = ? AND name = ?')
      .get(kind, item.id, item.name) as { label: string } | undefined
    return row?.label ?? ''
  }
  aliases(kind: Kind) {
    return new Map((this.sql.prepare('SELECT id,name,label FROM aliases WHERE kind = ?').all(kind) as (Binding & { label: string })[])
      .map(item => [item.id, item]))
  }
  setAlias(kind: Kind, item: Binding, label: string) {
    if (!label) this.sql.prepare('DELETE FROM aliases WHERE kind = ? AND id = ?').run(kind, item.id)
    else this.sql.prepare(`
      INSERT INTO aliases VALUES (?, ?, ?, ?)
      ON CONFLICT(kind, id) DO UPDATE SET name = excluded.name, label = excluded.label
    `).run(kind, item.id, item.name, label)
  }

  catalogue(key: string) {
    const row = this.sql.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    return row ? JSON.parse(row.value) as Catalogue : undefined
  }
  saveCatalogue(key: string, catalogue: Catalogue) {
    this.sql.prepare('INSERT INTO settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(catalogue))
  }

  controllerSettings() {
    const row = this.sql.prepare("SELECT value FROM settings WHERE key = 'controller-settings'").get() as { value: string } | undefined
    return row ? JSON.parse(row.value) as ControllerSettings : undefined
  }

  saveControllerSettings(settings: ControllerSettings) {
    this.sql.prepare("INSERT INTO settings VALUES ('controller-settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify(settings))
  }

  take(user: string, id: string) {
    return this.sql.prepare('SELECT fingerprint,result,attempted FROM takes WHERE user_id = ? AND id = ?')
      .get(user, id) as ActionRow | undefined
  }
  recordTake(user: string, id: string, fingerprint: string) {
    this.sql.prepare('INSERT INTO takes (user_id,id,fingerprint,created_at) VALUES (?,?,?,?)').run(user, id, fingerprint, Date.now())
  }
  attempted(user: string, id: string) {
    this.sql.prepare('UPDATE takes SET attempted = 1 WHERE user_id = ? AND id = ?').run(user, id)
  }
  finishTake(user: string, id: string, result: TakeResult) {
    this.sql.prepare('UPDATE takes SET result = ? WHERE user_id = ? AND id = ?').run(JSON.stringify(result), user, id)
  }
}

