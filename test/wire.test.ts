import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Decoder, decodeStatus, encode, levelMask, readCatalogue } from '../server/wire.ts'
import type { Catalogue } from '../shared/model.ts'

const item = (id: string, name: string) => ({ id, name, label: name })
const catalogue: Catalogue = {
  sources: [item('0000', 'CAM, A'), item('0001', 'CAM B')],
  destinations: [item('00CD', 'DST 206')], levels: [item('00', 'VID'), item('01', 'AUD 1')], salvos: [],
}

test('verified wire bytes, fragmented TCP, and checksum rejection', () => {
  const raw = encode(['TD', 'DST 206', 'A-CAM-2'])
  assert.equal(raw.toString('hex'), '014e305444094453542032303609412d43414d2d32393704')
  assert.equal(encode(['QD']).toString('hex'), '014e305144454404')
  const decoder = new Decoder()
  assert.deepEqual(decoder.push(raw.subarray(0, 6)), [])
  assert.equal(decoder.pending, true)
  assert.deepEqual(decoder.push(Buffer.concat([raw.subarray(6), encode(['QD'])])), [
    { sequence: '0', fields: ['TD', 'DST 206', 'A-CAM-2'] }, { sequence: '0', fields: ['QD'] },
  ])
  const bad = Buffer.from(raw)
  bad[5]++
  assert.throws(() => decoder.push(bad), /checksum/)
  assert.throws(() => encode(['TD', 'DST 206\tBAD']), /Invalid/)
  assert.equal(levelMask(['00', '1F']), '80000001')
})

test('catalogue continuation, blank names, mixed and unmatched levels', () => {
  const decoder = new Decoder()
  const frames = decoder.push(Buffer.concat([
    encode(['NQ', 'S', '1', 'CAM, A', '0000', 'N', 'FFFFFFFF'], '9'),
    encode(['NQ', 'S', '1', '', '0001', 'N', 'FFFFFFFF']),
  ]))
  assert.deepEqual(readCatalogue(frames, 'S'), [item('0000', 'CAM, A'), item('0001', '')])
  assert.throws(() => readCatalogue(frames.slice(0, 1), 'S'), /Incomplete/)
  const delta = decoder.push(Buffer.concat([
    encode(['DQ', 'DST 206', '1', 'N', 'N', 'CAM, A', '00000001', '', ''], '9'),
    encode(['DQ', 'DST 206', '1', 'N', 'N', 'CAM B', '00000002', '', '']),
  ]))
  assert.equal(decodeStatus(delta, catalogue).get('00CD')?.['01'].sourceId, '0001')
  assert.throws(() => decodeStatus(delta.slice(0, 1), catalogue), /Incomplete/)
  const indexed = decoder.push(encode(['jQ', '00CD', '1', 'N', 'N', 'fffe', '00000002', '', '']))
  assert.equal(decodeStatus(indexed, catalogue, '00CD').get('00CD')?.['01'].sourceId, null)
  const empty = decoder.push(encode(['DQ', 'DST 206', '0']))
  assert.deepEqual(decodeStatus(empty, catalogue).get('00CD'), {})
})

