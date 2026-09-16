/* The sync record: what both screens read to say what a sync is doing. */
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { memoryCollections, invoke } = require('./helpers/memory-db')
const { recordSync } = require('../lib/sync-status')
const admin = require('../actions/admin')
const health = require('../actions/health')

let cols
beforeEach(() => { cols = memoryCollections() })

test('a sync runs requested -> running with phases and counts -> done, and health reports it', async () => {
  await recordSync(cols, { state: 'requested' }, 't0')
  await recordSync(cols, { state: 'running', phase: 'reading' }, 't1')
  await recordSync(cols, { state: 'running', phase: 'partners', partners: { done: 0, total: 4 }, products: { done: 0, total: 182 } }, 't2')
  await recordSync(cols, { state: 'running', phase: 'products', partners: { done: 4, total: 4 }, products: { done: 100, total: 182 } }, 't3')
  const done = await recordSync(cols, { state: 'done', products: { done: 182, total: 182 } }, 't4')

  assert.deepEqual(done, {
    state: 'done',
    requestedAt: 't0',
    startedAt: 't1',
    updatedAt: 't4',
    finishedAt: 't4',
    phase: 'products',
    partners: { done: 4, total: 4 },
    products: { done: 182, total: 182 }
  })
  assert.deepEqual((await invoke(health, cols)).body.sync, done)
})

test('a new run starts clean: last run\'s counts and error are gone', async () => {
  await recordSync(cols, { state: 'running', phase: 'products', products: { done: 5, total: 9 } }, 't1')
  await recordSync(cols, { state: 'failed', error: 'Commerce refused the credential (401).' }, 't2')
  const next = await recordSync(cols, { state: 'running', phase: 'reading' }, 't3')
  assert.deepEqual(next, { state: 'running', startedAt: 't3', updatedAt: 't3', phase: 'reading' })
})

test('a failure keeps its reason, trimmed; a success clears one', async () => {
  const failed = await recordSync(cols, { state: 'failed', error: 'x'.repeat(500) }, 't1')
  assert.equal(failed.error.length, 300)
  assert.equal(failed.finishedAt, 't1')
  await recordSync(cols, { state: 'running', phase: 'reading' }, 't2')
  const done = await recordSync(cols, { state: 'done' }, 't3')
  assert.equal(done.error, undefined)
})

test('nonsense is refused with a 400, and nothing is recorded', async () => {
  for (const patch of [{}, { state: 'maybe' }, { state: 'running', phase: 'guessing' }, { state: 'running', products: { done: 3, total: 2 } }, { state: 'running', partners: { done: -1, total: 2 } }]) {
    await assert.rejects(recordSync(cols, patch), (e) => e.statusCode === 400)
  }
  assert.equal((await invoke(health, cols)).body.sync, null)
})

test('the integration reports through POST admin/sync', async () => {
  const res = await invoke(admin, cols, { method: 'POST', path: '/sync', body: { state: 'running', phase: 'reading' } })
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.state, 'running')
  assert.equal((await invoke(admin, cols, { method: 'POST', path: '/sync', body: { state: 'nope' } })).statusCode, 400)
})
