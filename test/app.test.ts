import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { setTimeout as wait } from 'node:timers/promises'
import { test } from 'node:test'
import type { HTTPMethods } from 'fastify'
import { createApp } from '../server/app.ts'
import { hashPassword } from '../server/auth.ts'
import { Store } from '../server/db.ts'
import { Router } from '../server/router.ts'
import { startSimulator } from '../server/simulator.ts'
import { takeService } from '../server/takes.ts'
import type { Item, PanelView, Route, TakeResult, User } from '../shared/model.ts'

const origin = 'http://127.0.0.1:8088'
const secret = 'test-only-simulator-password'

async function eventually(check: () => boolean) {
  const stop = Date.now() + 6500
  while (!check()) {
    if (Date.now() > stop) throw new Error('Timed out waiting for simulated state')
    await wait(40)
  }
}

test('admin access, catalogue, both level scopes, deduplication, and uncertain writes', async () => {
  const sim = await startSimulator()
  const db = new Store(':memory:')
  const router = new Router({ ...sim, mode: 'simulator', selectedLevels: false })
  const app = await createApp({ db, router, origins: [origin], catalogueKey: 'test', assets: 'missing-assets' })
  try {
    db.saveUser({ username: 'admin', password: await hashPassword(secret), enabled: true, panelIds: [] }, undefined, 'admin')
    function request(method: HTTPMethods, url: string, payload?: object, cookie?: string) {
      return app.inject({ method, url: '/api' + url, payload, headers: { origin, ...(cookie ? { cookie } : {}) } })
    }
    async function login(username: string, password = secret) {
      const response = await request('POST', '/login', { username, password })
      assert.equal(response.statusCode, 200, response.body)
      const cookie = String(response.headers['set-cookie'])
      assert.match(cookie, /HttpOnly/)
      return cookie.split(';')[0]
    }
    const admin = await login('admin')
    assert.equal(router.status.state, 'offline')
    assert.equal((await app.inject({ method: 'PUT', url: '/api/admin/router', payload: { enabled: true },
      headers: { origin: 'http://other.invalid', cookie: admin } })).statusCode, 403)
    assert.equal((await request('PUT', '/admin/router', { enabled: true }, admin)).statusCode, 200)
    await eventually(() => router.status.state === 'live')
    assert.equal(router.routes.size, 8)
    assert.equal(router.catalogue.levels.length, 17)
    assert.equal(router.catalogue.salvos.length, 2)
    assert.equal((await request('PUT', '/admin/aliases/sources',
      { id: '0001', name: 'CAM 2', alias: 'Interview' }, admin)).statusCode, 200)

    const asBinding = ({ id, name }: Item) => ({ id, name })
    const fields = {
      name: 'Master control', sources: router.catalogue.sources.slice(0, 4).map(asBinding),
      destinations: router.catalogue.destinations.map(asBinding), columns: 6, useTake: true,
    }
    async function createPanel(levels: object[] | null) {
      const response = await request('POST', '/admin/panels', { ...fields, levels }, admin)
      assert.equal(response.statusCode, 200, response.body)
      return response.json<PanelView>()
    }
    const all = await createPanel(null)
    const video = await createPanel([asBinding(router.catalogue.levels[0])])
    assert.equal(all.sources[1].label, 'Interview')
    const userResponse = await request('POST', '/admin/users', {
      username: 'operator', password: secret, enabled: true, panelIds: [all.id, video.id],
    }, admin)
    assert.equal(userResponse.statusCode, 200)
    const user = userResponse.json<User>()
    const operator = await login('operator')
    assert.equal((await request('GET', '/admin', undefined, operator)).statusCode, 403)
    const initial = (await request('GET', '/state', undefined, operator)).json()
    assert.equal(initial.panels.length, 2)
    assert.deepEqual(initial.levels, router.catalogue.levels.map(asBinding))

    async function status(panel: PanelView, destination = '0000') {
      const response = await request('GET', '/panels/' + panel.id + '/destinations/' + destination, undefined, operator)
      assert.equal(response.statusCode, 200, response.body)
      return response.json<Route>()
    }
    function action(panel: PanelView, read: Route, sourceId: string) {
      return { actionId: randomUUID(), sourceId, destinationId: read.destinationId, revision: read.revision, panelVersion: panel.version }
    }
    async function take(panel: PanelView, input: ReturnType<typeof action>) {
      const response = await request('POST', '/panels/' + panel.id + '/takes', input, operator)
      assert.equal(response.statusCode, 200, response.body)
      return response.json<TakeResult>()
    }
    const before = await status(all)
    const input = action(all, before, '0001')
    assert.equal((await take(all, input)).outcome, 'confirmed')
    assert.equal((await take(all, input)).outcome, 'confirmed')
    assert.equal(sim.controls.takes, 1)
    assert.ok(Object.values((await status(all)).levels).every(point => point.sourceId === '0001'))
    assert.equal((await take(all, action(all, before, '0002'))).outcome, 'conflict')

    const subset = await take(video, action(video, await status(video), '0002'))
    assert.equal(subset.outcome, 'confirmed')
    assert.equal(subset.route?.levels['00'].sourceId, '0002')
    assert.equal(subset.route?.levels['01'].sourceId, '0001')
    assert.equal((await take(all, action(all, await status(all, '0007'), '0000'))).outcome, 'blocked')
    assert.equal(sim.controls.takes, 2)

    sim.externalTake(0, 3)
    await eventually(() => router.routes.get('0000')?.levels['00'].sourceId === '0003')
    sim.controls.partial = true
    assert.equal((await take(all, action(all, await status(all), '0000'))).outcome, 'mismatch')
    sim.controls.partial = false
    sim.controls.dropAfterTake = true
    const uncertain = action(all, await status(all), '0002')
    assert.equal((await take(all, uncertain)).outcome, 'uncertain')
    await eventually(() => router.status.state === 'live')
    assert.equal((await take(all, uncertain)).outcome, 'uncertain')
    assert.equal(sim.controls.takes, 4)
    assert.equal((await status(all)).levels['00'].sourceId, '0002')

    assert.equal((await request('PUT', '/admin/users/' + user.id, {
      username: 'operator', enabled: true, panelIds: [video.id], password: 'new-simulator-password',
    }, admin)).statusCode, 200)
    assert.equal((await request('GET', '/state', undefined, operator)).statusCode, 401)
    const replacement = await login('operator', 'new-simulator-password')
    assert.equal((await request('GET', '/panels/' + all.id + '/destinations/0000', undefined, replacement)).statusCode, 403)
    await request('PUT', '/admin/router', { enabled: false }, admin)
    assert.equal(router.status.state, 'offline')
  } finally {
    await app.close()
    await sim.close()
    db.sql.close()
  }
})

test('live read-only mode and the selected-level gate send no writes', async () => {
  const sim = await startSimulator()
  const db = new Store(':memory:')
  const account = db.saveUser({ username: 'guard-test', password: 'unused', enabled: true, panelIds: [] })
  try {
    for (const mode of ['live-readonly', 'live'] as const) {
      const router = new Router({ ...sim, mode, selectedLevels: false })
      try {
        router.enable(true)
        await eventually(() => router.status.state === 'live')
        const panel = db.savePanel({ name: 'Video only', sources: [router.catalogue.sources[1]],
          destinations: [router.catalogue.destinations[0]], levels: [router.catalogue.levels[0]], columns: 4, useTake: true })
        const route = await router.withLink(link => link.read('0000'))
        const result = await takeService(db, router)(account.id, panel.id, {
          actionId: randomUUID(), destinationId: '0000', sourceId: '0001', revision: route.revision, panelVersion: panel.version,
        }, () => panel)
        assert.equal(result.outcome, 'blocked')
        assert.match(result.message, mode === 'live-readonly' ? /read-only/ : /gated/)
        assert.equal(sim.controls.takes, 0)
      } finally {
        await router.stop()
      }
    }
  } finally {
    await sim.close()
    db.sql.close()
  }
})

