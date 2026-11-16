import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { Writable } from 'node:stream'
import Database from 'better-sqlite3'
import { configuration } from './config.ts'
import { Store } from './db.ts'
import { hashPassword } from './auth.ts'
import { MIN_PASSWORD_LENGTH } from '../shared/model.ts'

const [command, value] = process.argv.slice(2).filter(arg => arg !== '--')
const config = configuration()
if (command === 'admin') {
  const db = new Store(config.database)
  try {
    if (!value || !/^[A-Za-z0-9_.-]{2,40}$/.test(value)) throw new Error('Usage: pnpm admin studio-admin')
    if (db.users().some(user => user.role === 'admin')) throw new Error('An admin already exists.')
    let password = process.env.BCS_ADMIN_PASSWORD
    if (!password) {
      const silent = new Writable({ write(_chunk, _encoding, done) { done() } })
      const reader = createInterface({ input: process.stdin, output: silent, terminal: Boolean(process.stdin.isTTY) })
      process.stdout.write(`Admin password (at least ${MIN_PASSWORD_LENGTH} characters): `)
      try { password = await reader.question('') } finally { reader.close(); process.stdout.write('\n') }
    }
    if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Password must contain at least ${MIN_PASSWORD_LENGTH} characters.`)
    db.saveUser({ username: value, password: await hashPassword(password), enabled: true, panelIds: [] }, undefined, 'admin')
    console.log('Administrator created for ' + config.mode + '.')
  } finally { db.sql.close() }
} else if (command === 'backup' && value) {
  const target = resolve(value)
  if (target.toLowerCase() === config.database.toLowerCase()) throw new Error('Choose a separate backup path.')
  const db = new Database(config.database, { readonly: true, fileMustExist: true })
  try {
    mkdirSync(dirname(target), { recursive: true })
    await db.backup(target)
    console.log('Backup saved to ' + target)
  } finally { db.close() }
} else throw new Error('Usage: pnpm admin studio-admin or pnpm backup path-to-backup.sqlite')

