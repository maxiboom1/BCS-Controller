import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Route } from '../shared/model.ts'
import { groupRouteLevels, isMixedRoute } from '../web/routeLevels.ts'

test('mixed routes group consecutive audio levels by source identity', () => {
  const names = ['VID', 'AUD 1', 'AUD 2', 'AUD 3', 'A4', 'AUDIO 5', 'AUD 7', 'Data', 'Control']
  const levels = names.map((name, index) => ({ id: String(index), name }))
  const route: Route = {
    destinationId: '00', revision: 'one', sourceLabels: { '0001': 'Shared alias', '0002': 'Shared alias' },
    levels: Object.fromEntries(['0001', '0001', '0001', '0002', null, null, null, '0002'].map((sourceId, index) =>
      [String(index), { sourceId, protected: false, chopping: index === 7 }])),
  }
  assert.equal(isMixedRoute(route), true)
  assert.deepEqual(groupRouteLevels(levels, route).map(({ label, source, chopping }) => [label, source, chopping]), [
    ['V', 'Shared alias', false], ['A1–2', 'Shared alias', false], ['A3', 'Shared alias', false],
    ['A4–5', 'No crosspoint', false], ['A7', 'No crosspoint', false], ['Data', 'Shared alias', true], ['Control', 'Unavailable', false],
  ])
  const noCrosspoint = { sourceId: null, protected: false, chopping: false }
  assert.equal(isMixedRoute({ ...route, levels: { '0': noCrosspoint } }), false)
  assert.equal(isMixedRoute({ ...route, levels: { '0': { ...noCrosspoint, chopping: true } } }), true)
})
