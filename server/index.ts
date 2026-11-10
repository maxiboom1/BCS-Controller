import { readFileSync } from 'node:fs'
import { createApp } from './app.ts'
import { configuration } from './config.ts'
import { Store } from './db.ts'
import { Router } from './router.ts'
import { consoleLogger, release } from './log.ts'
import { DEFAULT_SETTINGS, endpointAddress } from './settings.ts'

const config = configuration()
const log = consoleLogger(true)
log(`Starting Ultrix Controller ${release}`)
const db = new Store(config.database)
const settings = db.controllerSettings() ?? {
  ...DEFAULT_SETTINGS, bcsHost: config.bcsHost, bcsPort: config.bcsPort, webPort: config.port,
}
const port = process.env.WEB_PORT ? config.port : settings.webPort
const certPath = process.env.WEB_TLS_CERT
const keyPath = process.env.WEB_TLS_KEY
const localHttp = process.env.WEB_ALLOW_LOCAL_HTTP === 'yes' && config.host === '127.0.0.1'
const origin = process.env.WEB_ORIGIN || (localHttp && !certPath ? new URL(`http://localhost:${port}`).origin : undefined)
const allowLocalHttp = localHttp && ['127.0.0.1', 'localhost'].some(host => origin === new URL(`http://${host}:${port}`).origin)
if (Boolean(certPath) !== Boolean(keyPath)) throw new Error('Set both WEB_TLS_CERT and WEB_TLS_KEY')
if (origin && new URL(origin).origin !== origin) throw new Error('WEB_ORIGIN must be an exact origin')
if ((!certPath || !origin?.startsWith('https://')) && (config.mode !== 'simulator' || config.host !== '127.0.0.1') && !allowLocalHttp) {
  throw new Error('Live mode and LAN binding require TLS and an HTTPS WEB_ORIGIN.')
}
if (certPath && !origin?.startsWith('https://')) throw new Error('TLS requires an HTTPS WEB_ORIGIN.')
const tls = certPath && keyPath ? { cert: readFileSync(certPath), key: readFileSync(keyPath) } : undefined
type LocalSimulator = { host: string; port: number; close: () => Promise<void> }
const simulator: LocalSimulator | null = config.mode === 'simulator'
  ? await import(new URL('./simulator.ts', import.meta.url).href).then(module => module.startSimulator()) : null
const catalogueKey = simulator ? 'simulator' : 'live:' + endpointAddress(settings.bcsHost, settings.bcsPort)
const router = new Router({
  host: simulator?.host ?? settings.bcsHost, port: simulator?.port ?? settings.bcsPort,
  mode: config.mode, selectedLevels: config.selectedLevels,
}, db.catalogue(catalogueKey), settings.pollIntervalMs)
const url = origin ?? `http://${endpointAddress(config.host, port)}`
const app = await createApp({
  db, router, catalogueKey, tls, log: true, settings, activePort: port, activeUrl: url,
  origins: origin ? [origin] : ['http://127.0.0.1:' + port, 'http://127.0.0.1:5173'],
})
app.addHook('onClose', async () => {
  await simulator?.close()
  db.sql.close()
})
try {
  await app.listen({ port, host: config.host })
  db.recoverTakes()
  log('Loaded database · OK')
  log(`App ready · Admin ${url}/admin · Operator ${url}/`)
  if (config.mode !== 'simulator') router.enable(true)
} catch (error) {
  await app.close()
  log(`Startup failed · ${(error as Error).message}`, 'ERROR')
  process.exitCode = 1
}
const stop = () => {
  log('Stopping Ultrix Controller')
  app.close().catch(error => { log(`Shutdown failed · ${(error as Error).message}`, 'ERROR'); process.exitCode = 1 })
}
process.once('SIGTERM', stop)
process.once('SIGINT', stop)

