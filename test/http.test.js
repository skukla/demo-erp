const { test } = require('node:test')
const assert = require('node:assert/strict')
const { body } = require('../lib/http')

// A non-raw web action merges the JSON request body into params and sets no
// __ow_body, so body() falls back to "the caller's fields minus Runtime's
// plumbing". The action's declared inputs (ERP_ID, ERP_DISPLAY_NAME, EVENTS_*,
// LOG_LEVEL) ride in params on every invocation and must NOT be read as body —
// patchProduct rejects any key it does not own, so a leaked ERP_ID answered
// "ERP_ID cannot be edited" for every write_erp_rest edit (AB-40).
test('body() strips the action inputs Runtime injects, keeping only the caller fields', () => {
  const params = {
    __ow_method: 'PATCH',
    __ow_path: '/accesspoint',
    __ims_oauth_s2s: 'secret',
    ERP_ID: 'erp',
    ERP_DISPLAY_NAME: 'Northwind ERP',
    LOG_LEVEL: 'info',
    EVENTS_WEBHOOK_URL: 'https://x',
    listPrice: 249
  }
  assert.deepEqual(body(params), { listPrice: 249 })
})

test('body() still prefers a real __ow_body when present', () => {
  const params = { __ow_body: JSON.stringify({ listPrice: 5 }), ERP_ID: 'erp' }
  assert.deepEqual(body(params), { listPrice: 5 })
})
