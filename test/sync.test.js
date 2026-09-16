/* Sync records: the ERP asks its subscriber to send its records again, and says so when it cannot. */
const { test, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const contract = require('../contract/erp-contract.json')
const { syncUrl, requestSync } = require('../lib/sync')

const realNs = process.env.__OW_NAMESPACE
afterEach(() => {
  if (realNs === undefined) delete process.env.__OW_NAMESPACE
  else process.env.__OW_NAMESPACE = realNs
})

function answer (status, text = '') {
  return async () => ({ status, text: async () => text })
}

test('the address is the subscriber in this namespace, at the path the contract names', () => {
  process.env.__OW_NAMESPACE = '1234-demo-stage'
  assert.equal(syncUrl({}), `https://1234-demo-stage.adobeio-static.net${contract.sync.path}`)
  assert.equal(contract.sync.path, '/api/v1/web/erp/mirror?background=true')
})

test('SYNC_URL overrides the address; with neither there is none', () => {
  assert.equal(syncUrl({ SYNC_URL: 'https://elsewhere.example/sync' }), 'https://elsewhere.example/sync')
  delete process.env.__OW_NAMESPACE
  assert.equal(syncUrl({}), null)
})

test('posts to the subscriber with the ERP credential and reports it started', async () => {
  const calls = []
  const fetch = async (url, init) => { calls.push({ url, init }); return { status: contract.sync.answers, text: async () => '' } }

  const result = await requestSync({ SYNC_URL: 'https://x.example/sync' }, { fetch, headers: { Authorization: 'Bearer t' } })

  assert.deepEqual(result, { started: true })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://x.example/sync')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.headers.Authorization, 'Bearer t')
})

test('a subscriber that answers anything but 202 is a refusal, named with its status', async () => {
  await assert.rejects(
    requestSync({ SYNC_URL: 'https://x.example/sync' }, { fetch: answer(401, 'invalid token'), headers: {} }),
    (e) => e.statusCode === 502 && e.code === 'SYNC_REFUSED' && /401: invalid token/.test(e.message)
  )
  // A 200 means the subscriber ran the mirror inline or does not know background mode.
  await assert.rejects(
    requestSync({ SYNC_URL: 'https://x.example/sync' }, { fetch: answer(200), headers: {} }),
    (e) => e.code === 'SYNC_REFUSED'
  )
})

test('an unreachable subscriber and a missing address are named, not thrown raw', async () => {
  const down = async () => { throw new Error('ECONNREFUSED') }
  await assert.rejects(
    requestSync({ SYNC_URL: 'https://x.example/sync' }, { fetch: down, headers: {} }),
    (e) => e.statusCode === 502 && e.code === 'SYNC_UNREACHABLE' && /ECONNREFUSED/.test(e.message)
  )
  delete process.env.__OW_NAMESPACE
  await assert.rejects(requestSync({}, { fetch: down }), (e) => e.statusCode === 503 && e.code === 'SYNC_UNAVAILABLE')
})
