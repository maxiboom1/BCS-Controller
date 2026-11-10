import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'
import { configuration } from './config.ts'
import { Store } from './db.ts'
import { hashPassword } from './auth.ts'

const [command, value] = process.argv.slice(2).filter(arg => arg !== '--')
const config = configuration()
const db = new Store(config.database)
try {
  if (command === 'admin') {
    if (!value || !/^[A-Za-z0-9_.-]{2,40}$/.test(value)) throw new Error('Usage: pnpm admin studio-admin')
    if (db.users().some(user => user.role === 'admin')) throw new Error('An admin already exists.')
    let password = process.env.BCS_ADMIN_PASSWORD
    if (!password) {
      const silent = new Writable({ write(_chunk, _encoding, done) { done() } })
      const reader = createInterface({ input: process.stdin, output: silent, terminal: Boolean(process.stdin.isTTY) })
      process.stdout.write('Admin password (12–128 characters): ')
      try { password = await reader.question('') } finally { reader.close(); process.stdout.write('\n') }
    }
    if (password.length < 12 || password.length > 128) throw new Error('Password must contain 12–128 characters.')
    db.saveUser({ username: value, password: await hashPassword(password), enabled: true, panelIds: [] }, undefined, 'admin')
    console.log('Administrator created for ' + config.mode + '.')
  } else if (command === 'backup' && value) {
    const target = resolve(value)
    if (target.toLowerCase() === config.database.toLowerCase()) throw new Error('Choose a separate backup path.')
    mkdirSync(dirname(target), { recursive: true })
    await db.sql.backup(target)
    console.log('Backup saved to ' + target)
  } else throw new Error('Usage: pnpm admin studio-admin or pnpm backup path-to-backup.sqlite')
} finally {
  db.sql.close()
}

