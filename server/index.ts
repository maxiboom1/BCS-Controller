import { readFileSync } from 'node:fs'
import { createApp } from './app.ts'
import { configuration } from './config.ts'
import { Store } from './db.ts'
import { Router } from './router.ts'
import { startSimulator } from './simulator.ts'

const config = configuration()
const certPath = process.env.WEB_TLS_CERT
const keyPath = process.env.WEB_TLS_KEY
const origin = process.env.WEB_ORIGIN
const allowLocalHttp = process.env.WEB_ALLOW_LOCAL_HTTP === 'yes' && config.host === '127.0.0.1' &&
  ['127.0.0.1', 'localhost'].some(host => origin === new URL(`http://${host}:${config.port}`).origin)
if (Boolean(certPath) !== Boolean(keyPath)) throw new Error('Set both WEB_TLS_CERT and WEB_TLS_KEY')
if (origin && new URL(origin).origin !== origin) throw new Error('WEB_ORIGIN must be an exact origin')
if ((!certPath || !origin?.startsWith('https://')) && (config.mode !== 'simulator' || config.host !== '127.0.0.1') && !allowLocalHttp) {
  throw new Error('Live mode and LAN binding require TLS and an HTTPS WEB_ORIGIN.')
}
if (certPath && !origin?.startsWith('https://')) throw new Error('TLS requires an HTTPS WEB_ORIGIN.')
const tls = certPath && keyPath ? { cert: readFileSync(certPath), key: readFileSync(keyPath) } : undefined
const simulator = config.mode === 'simulator' ? await startSimulator() : null
const db = new Store(config.database)
const catalogueKey = simulator ? 'simulator' : 'live:' + config.bcsHost + ':' + config.bcsPort
const router = new Router({
  host: simulator?.host ?? config.bcsHost, port: simulator?.port ?? config.bcsPort,
  mode: config.mode, selectedLevels: config.selectedLevels,
}, db.catalogue(catalogueKey))
const app = await createApp({
  db, router, catalogueKey, tls, log: true,
  origins: origin ? [origin] : ['http://127.0.0.1:' + config.port, 'http://127.0.0.1:5173'],
})
app.addHook('onClose', async () => {
  await simulator?.close()
  db.sql.close()
})
try {
  await app.listen({ port: config.port, host: config.host })
  db.recoverTakes()
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  app.log.info({ version, mode: config.mode, endpoint: router.status.endpoint, state: router.status.state }, 'Ultrix Controller ready')
} catch (error) {
  await app.close()
  throw error
}
const stop = () => { app.close().catch(error => { app.log.error(error); process.exitCode = 1 }) }
process.once('SIGTERM', stop)
process.once('SIGINT', stop)

