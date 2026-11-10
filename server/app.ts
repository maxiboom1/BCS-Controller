import Fastify from 'fastify'
import type { FastifyRequest } from 'fastify'
import type { ServerResponse } from 'node:http'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import staticFiles from '@fastify/static'
import { z } from 'zod'
import type { Kind, Snapshot } from '../shared/model.ts'
import type { Store } from './db.ts'
import type { Router } from './router.ts'
import { checkPassword, hashPassword, newToken, tokenHash } from './auth.ts'
import { validBindings, viewPanel, viewRoute } from './views.ts'
import { takeService } from './takes.ts'

const username = z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9_.-]+$/)
export const password = z.string().min(12).max(128)
const userInput = z.object({ username, password: password.optional(), enabled: z.boolean(), panelIds: z.array(z.uuid()).max(200) })
const binding = z.object({ id: z.string().min(1).max(120), name: z.string().min(1).max(120) })
const panelInput = z.object({
  name: z.string().trim().min(1).max(80), sources: z.array(binding).min(1).max(500),
  destinations: z.array(binding).min(1).max(500), levels: z.array(binding).min(1).max(32).nullable(),
  columns: z.number().int().min(2).max(12), useTake: z.boolean(),
})
const takeInput = z.object({ actionId: z.uuid(), sourceId: z.string().regex(/^[0-9A-F]{4}$/),
  destinationId: z.string().regex(/^[0-9A-F]{4}$/), revision: z.uuid(), panelVersion: z.number().int().positive() })
const uuidParam = z.object({ id: z.uuid() })
const catalogKind = z.enum(['sources', 'destinations', 'levels', 'salvos'])

class HttpError extends Error {
  statusCode: number
  constructor(statusCode: number, message: string) { super(message); this.statusCode = statusCode }
}

type AppOptions = {
  db: Store; router: Router; origins: string[]; catalogueKey: string; assets?: string
  tls?: { key: Buffer; cert: Buffer }; log?: boolean
}

export async function createApp(options: AppOptions) {
  const { db, router } = options
  const app = Fastify({ logger: options.log ?? false, bodyLimit: 256 * 1024, ...(options.tls ? { https: options.tls } : {}) })
  const cookie = options.tls ? '__Host-bcs' : 'bcs'
  const cookieAttributes = '; Path=/; HttpOnly; SameSite=Strict' + (options.tls ? '; Secure' : '')
  const streams = new Map<ServerResponse, { session: string; paused: boolean; queue: string[]; bytes: number }>()
  const logins = new Map<string, { attempts: number; until: number }>()
  let passwordJobs = 0
  const executeTake = takeService(db, router)

  function token(request: FastifyRequest) {
    const value = request.headers.cookie?.split(';').map(value => value.trim())
      .find(value => value.startsWith(cookie + '='))?.slice(cookie.length + 1)
    return value && /^[a-f0-9]{64}$/.test(value) ? tokenHash(value) : ''
  }
  function user(request: FastifyRequest) {
    const account = db.sessionUser(token(request))
    if (!account) throw new HttpError(401, 'Sign in to continue.')
    return account
  }
  function admin(request: FastifyRequest) {
    if (user(request).role !== 'admin') throw new HttpError(403, 'Administrator access required.')
  }
  function panelFor(request: FastifyRequest, id: string) {
    if (!user(request).panelIds.includes(id)) throw new HttpError(403, 'Panel is not assigned to this account.')
    const panel = db.findPanel(id)
    if (!panel) throw new HttpError(404, 'Panel not found.')
    return panel
  }

  function snapshot(session: string): Snapshot | undefined {
    const account = db.sessionUser(session)
    if (!account) return
    const panels = db.panels().filter(panel => account.panelIds.includes(panel.id)).map(panel => viewPanel(db, router, panel))
    const ids = new Set(panels.flatMap(panel => panel.destinations.filter(item => item.valid).map(item => item.id)))
    const routes = [...ids].flatMap(id => viewRoute(db, router, id) ?? [])
    const levels = router.catalogue.levels.map(({ id, name }) => ({ id, name }))
    return { user: account, panels, router: router.status, routes, levels }
  }
  function event(stream: ServerResponse, name: string, value: unknown) {
    if (stream.destroyed || stream.writableEnded) return
    const client = streams.get(stream)
    if (!client) return
    const message = 'event: ' + name + '\ndata: ' + JSON.stringify(value) + '\n\n'
    if (!client.paused) client.paused = !stream.write(message)
    else {
      client.queue.push(message)
      client.bytes += Buffer.byteLength(message)
      if (client.bytes > 4 * 1024 * 1024) stream.destroy()
    }
  }
  function publish(destinationId?: string) {
    for (const [stream, { session }] of streams) {
      const account = db.sessionUser(session)
      if (!account) { event(stream, 'expired', null); stream.end(); continue }
      if (!destinationId) { event(stream, 'snapshot', snapshot(session)); continue }
      const name = router.catalogue.destinations.find(item => item.id === destinationId)?.name
      if (account.panelIds.some(id => db.findPanel(id)?.destinations.some(item => item.id === destinationId && item.name === name))) {
        event(stream, 'route', viewRoute(db, router, destinationId))
      }
    }
  }
  let previousRouter = router.status
  router.changed = change => {
    const { state, mode, endpoint, lastError } = router.status
    if (state !== previousRouter.state || lastError !== previousRouter.lastError) {
      const fields = { state, mode, endpoint, ...(lastError ? { reason: lastError } : {}) }
      if (state === 'retrying') app.log.warn(fields, 'BCS connection retrying')
      else app.log.info(fields, 'Router status changed')
    }
    previousRouter = router.status
    if (change.catalogue) db.saveCatalogue(options.catalogueKey, router.catalogue)
    publish(change.destinationId)
  }

  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'same-origin')
      .header('X-Frame-Options', 'DENY')
    if (!request.url.startsWith('/api/')) return
    reply.header('Cache-Control', 'no-store')
    if (request.method !== 'GET' && request.method !== 'HEAD' &&
        (!request.headers.origin || !options.origins.includes(request.headers.origin))) {
      throw new HttpError(403, 'Request origin is not allowed.')
    }
  })
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: error.issues[0]?.message ?? 'Invalid request.' })
    if (error instanceof HttpError) return reply.code(error.statusCode).send({ error: error.message })
    if (error instanceof Error && 'code' in error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return reply.code(409).send({ error: 'That username is already in use.' })
    }
    request.log.error(error)
    return reply.code(500).send({ error: 'Server could not complete the request.' })
  })

  app.post('/api/login', async (request, reply) => {
    const input = z.object({ username, password: z.string().min(1).max(128) }).parse(request.body)
    const now = Date.now()
    for (const [key, entry] of logins) if (entry.until <= now) logins.delete(key)
    const key = request.ip
    const entry = logins.get(key) ?? { attempts: 0, until: now + 60_000 }
    if (entry.attempts >= 8 || passwordJobs >= 2) throw new HttpError(429, 'Please wait before trying again.')
    entry.attempts++
    logins.set(key, entry)
    const row = db.findByUsername(input.username)
    passwordJobs++
    const valid = await checkPassword(input.password, row?.password).finally(() => passwordJobs--)
    const current = row && db.findByUsername(input.username)
    if (!valid || !current?.enabled || current.password !== row?.password) throw new HttpError(401, 'Invalid username or password.')
    logins.delete(key)
    if (token(request)) db.logout(token(request))
    const value = newToken()
    db.session(tokenHash(value), current.id, now + 43_200_000)
    reply.header('Set-Cookie', cookie + '=' + value + cookieAttributes + '; Max-Age=43200')
    return snapshot(tokenHash(value))
  })
  app.post('/api/logout', async (request, reply) => {
    db.logout(token(request))
    publish()
    reply.header('Set-Cookie', cookie + '=' + cookieAttributes + '; Max-Age=0')
    return { ok: true }
  })
  app.get('/api/state', async request => { user(request); return snapshot(token(request)) })
  app.get('/api/events', async (request, reply) => {
    user(request)
    const session = token(request)
    const stream = reply.raw
    reply.hijack()
    stream.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store',
      Connection: 'keep-alive', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' })
    const client = { session, paused: false, queue: [] as string[], bytes: 0 }
    streams.set(stream, client)
    stream.on('drain', () => {
      client.paused = false
      while (!client.paused && client.queue.length && !stream.writableEnded) {
        const message = client.queue.shift()!
        client.bytes -= Buffer.byteLength(message)
        client.paused = !stream.write(message)
      }
    })
    stream.once('close', () => { streams.delete(stream); clearInterval(heartbeat) })
    const heartbeat = setInterval(() => {
      if (db.sessionUser(session)) event(stream, 'heartbeat', null)
      else { event(stream, 'expired', null); stream.end() }
    }, 10_000)
    event(stream, 'snapshot', snapshot(session))
  })
  app.get('/api/panels/:id/destinations/:destinationId', async request => {
    const params = z.object({ id: z.uuid(), destinationId: z.string().regex(/^[0-9A-F]{4}$/) }).parse(request.params)
    const check = () => {
      const panel = panelFor(request, params.id)
      const bound = panel.destinations.find(item => item.id === params.destinationId)
      if (!bound || !validBindings(router.catalogue.destinations, [bound])) throw new HttpError(409, 'Destination binding requires review.')
    }
    check()
    try {
      await router.withLink(async link => { check(); await link.read(params.destinationId); check() })
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw new HttpError(503, 'Fresh destination readback is unavailable.')
    }
    return viewRoute(db, router, params.destinationId)
  })
  app.post('/api/panels/:id/takes', async request => {
    const { id } = uuidParam.parse(request.params)
    return executeTake(user(request).id, id, takeInput.parse(request.body), () => panelFor(request, id))
  })

  app.get('/api/admin', async request => {
    admin(request)
    return { users: db.users(), panels: db.panels().map(panel => viewPanel(db, router, panel)), router: router.status }
  })
  for (const method of ['POST', 'PUT'] as const) {
    const path = '/api/admin/users' + (method === 'PUT' ? '/:id' : '')
    app.route({ method, url: path, handler: async request => {
      admin(request)
      const id = method === 'PUT' ? uuidParam.parse(request.params).id : undefined
      const input = userInput.parse(request.body)
      const previous = id ? db.findUser(id) : undefined
      if (id && !previous) throw new HttpError(404, 'User not found.')
      if (previous?.role === 'admin' && !input.enabled) throw new HttpError(400, 'The administrator must stay enabled.')
      if (!id && !input.password) throw new HttpError(400, 'Password required.')
      if (input.panelIds.some(panelId => !db.findPanel(panelId))) throw new HttpError(400, 'Unknown panel assignment.')
      const hashed = input.password ? await hashPassword(input.password) : undefined
      admin(request)
      const result = db.saveUser({ ...input, password: hashed }, id)
      publish()
      return result
    } })
    app.route({ method, url: '/api/admin/panels' + (method === 'PUT' ? '/:id' : ''), handler: async request => {
      admin(request)
      const id = method === 'PUT' ? uuidParam.parse(request.params).id : undefined
      if (id && !db.findPanel(id)) throw new HttpError(404, 'Panel not found.')
      const input = panelInput.parse(request.body)
      if (!validBindings(router.catalogue.sources, input.sources) ||
          !validBindings(router.catalogue.destinations, input.destinations) ||
          (input.levels && !validBindings(router.catalogue.levels, input.levels))) {
        throw new HttpError(409, 'Select valid, distinct catalogue entries before saving.')
      }
      const panel = db.savePanel(input, id, input.levels === null
        ? router.catalogue.levels.map(({ id, name }) => ({ id, name })) : undefined)
      publish()
      return viewPanel(db, router, panel)
    } })
  }

  app.put('/api/admin/router', async request => {
    admin(request)
    router.enable(z.object({ enabled: z.boolean() }).parse(request.body).enabled)
    return router.status
  })
  app.get('/api/admin/catalogue/:kind', async request => {
    admin(request)
    const { kind } = z.object({ kind: catalogKind }).parse(request.params)
    const { q, page } = z.object({ q: z.string().max(120).default(''), page: z.coerce.number().int().min(1).max(1000).default(1) }).parse(request.query)
    const aliases = db.aliases(kind)
    const needle = q.toLowerCase()
    const rows = router.catalogue[kind].filter(item => item.name.trim()).flatMap(item => {
      const stored = aliases.get(item.id)
      const alias = stored?.name === item.name ? stored.label : ''
      return (item.name + ' ' + alias).toLowerCase().includes(needle)
        ? [{ ...item, alias, label: alias || item.name }] : []
    })
    return { items: rows.slice((page - 1) * 50, page * 50), total: rows.length }
  })
  app.put('/api/admin/aliases/:kind', async request => {
    admin(request)
    const { kind } = z.object({ kind: z.enum(['sources', 'destinations', 'salvos']) }).parse(request.params)
    const { id, name, alias } = binding.extend({ alias: z.string().trim().max(80) }).parse(request.body)
    if (!validBindings(router.catalogue[kind as Kind], [{ id, name }])) throw new HttpError(409, 'Catalogue entry changed.')
    db.setAlias(kind, { id, name }, alias)
    publish()
    return { ok: true }
  })

  app.addHook('preClose', async () => {
    for (const stream of streams.keys()) stream.destroy()
    await router.stop()
  })
  const root = resolve(options.assets ?? 'dist')
  if (existsSync(resolve(root, 'index.html'))) {
    await app.register(staticFiles, { root })
    app.setNotFoundHandler((request, reply) =>
      request.method === 'GET' && !request.url.startsWith('/api/') ? reply.sendFile('index.html') : reply.code(404).send({ error: 'Not found.' }))
  }
  return app
}

