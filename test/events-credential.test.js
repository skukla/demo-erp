/*
 * An ERP in a workspace of its own posts its events to an integration in ANOTHER workspace.
 * That integration's ingestion action accepts only its own workspace's technical account, so
 * the ERP signs with the publishing credential the integration issued it (EVENTS_AUTH_*, set
 * at deploy), the way a real ERP posts to middleware with a credential the middleware gave it.
 * Without those inputs the ERP signs with its own credential exactly as before.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { deliver } = require('../lib/events')
const { body } = require('../lib/http')

const ENTRY = { _id: 'e1', event: 'be-observer.company_contract_update', value: { partnerId: 'P1', lines: [] } }
const INGESTION = 'https://integration-ns.adobeio-static.net/api/v1/web/ingestion/webhook'
const OWN = { client_id: 'erp-own-client', client_secrets: ['fake-own-secret-not-a-secret'], org_id: 'OWNORG@AdobeOrg', scopes: ['openid'] }
const PUBLISHING = {
  EVENTS_WEBHOOK_URL: INGESTION,
  EVENTS_AUTH_CLIENT_ID: 'integration-client',
  EVENTS_AUTH_CLIENT_SECRET: 'fake-test-pw-not-a-secret',
  EVENTS_AUTH_ORG_ID: 'INTEGRATIONORG@AdobeOrg',
  EVENTS_AUTH_SCOPES: '["AdobeID","openid","adobeio_api"]'
}

/** Deliver once, recording what was minted and what was posted. */
async function delivered (params) {
  const minted = []
  const posts = []
  const res = await deliver(params, ENTRY, {
    generateAccessToken: async (credentials) => { minted.push(credentials); return { access_token: `token-for-${credentials.clientId || 'own'}` } },
    fetch: async (url, init) => { posts.push({ url, headers: init.headers }); return { ok: true, status: 200 } }
  })
  return { res, minted, posts }
}

test('given a publishing credential, the event goes to the integration signed with a token minted for that client', async () => {
  const { res, minted, posts } = await delivered({ ...PUBLISHING, __ims_oauth_s2s: OWN })
  assert.equal(res.delivered, true)
  assert.deepEqual(minted, [{
    clientId: 'integration-client',
    clientSecret: 'fake-test-pw-not-a-secret',
    orgId: 'INTEGRATIONORG@AdobeOrg',
    scopes: ['AdobeID', 'openid', 'adobeio_api']
  }])
  assert.equal(posts[0].url, INGESTION)
  assert.equal(posts[0].headers.Authorization, 'Bearer token-for-integration-client')
  assert.equal(posts[0].headers['x-api-key'], 'integration-client')
  assert.equal(posts[0].headers['x-gw-ims-org-id'], 'INTEGRATIONORG@AdobeOrg')
})

test('without a publishing credential the ERP signs with its own, exactly as before', async () => {
  const params = { EVENTS_WEBHOOK_URL: INGESTION, __ims_oauth_s2s: OWN }
  const { minted, posts } = await delivered(params)
  assert.equal(minted[0], params, 'its own action params are what the token is minted from')
  assert.equal(posts[0].headers['x-api-key'], 'erp-own-client')
  assert.equal(posts[0].headers['x-gw-ims-org-id'], 'OWNORG@AdobeOrg')
})

test('publishing inputs left unset at deploy are not a credential, and an unset address is no address', async () => {
  const unset = {
    EVENTS_WEBHOOK_URL: '$EVENTS_WEBHOOK_URL',
    EVENTS_AUTH_CLIENT_ID: '$EVENTS_AUTH_CLIENT_ID',
    EVENTS_AUTH_CLIENT_SECRET: '',
    EVENTS_AUTH_ORG_ID: '$EVENTS_AUTH_ORG_ID',
    EVENTS_AUTH_SCOPES: '$EVENTS_AUTH_SCOPES',
    __ims_oauth_s2s: OWN
  }
  const previous = process.env.__OW_NAMESPACE
  process.env.__OW_NAMESPACE = 'erp-ns'
  try {
    const { posts } = await delivered(unset)
    assert.equal(posts[0].url, 'https://erp-ns.adobeio-static.net/api/v1/web/ingestion/webhook')
    assert.equal(posts[0].headers['x-api-key'], 'erp-own-client')
  } finally {
    if (previous === undefined) delete process.env.__OW_NAMESPACE
    else process.env.__OW_NAMESPACE = previous
  }
})

test('a publishing credential with unreadable scopes asks for none rather than failing', async () => {
  const { minted } = await delivered({ ...PUBLISHING, EVENTS_AUTH_SCOPES: 'not json' })
  assert.deepEqual(minted[0].scopes, [])
})

test('a publishing credential that cannot mint a token leaves the event pending, and the reason carries no secret', async () => {
  const res = await deliver(PUBLISHING, ENTRY, {
    generateAccessToken: async () => { throw new Error('IMS refused the client') },
    fetch: async () => { throw new Error('must not post unsigned') }
  })
  assert.equal(res.delivered, false)
  assert.equal(res.error, 'IMS refused the client')
  assert.doesNotMatch(JSON.stringify(res), /fake-test-pw-not-a-secret/)
})

test('the publishing credential is plumbing: it never reaches a handler as a caller field', () => {
  const fields = body({ ...PUBLISHING, name: 'Kept' })
  assert.deepEqual(fields, { name: 'Kept' })
})

test('every action deployed with an ERP id is also deployed with the event address and publishing credential', () => {
  const config = fs.readFileSync(path.join(__dirname, '..', 'app.config.yaml'), 'utf-8')
  const count = (name) => config.split('\n').filter((line) => line.trim() === `${name}: $${name}`).length
  const actions = count('ERP_ID')
  assert.ok(actions > 10, `found ${actions} actions with ERP_ID`)
  for (const name of Object.keys(PUBLISHING)) assert.equal(count(name), actions, name)
})
