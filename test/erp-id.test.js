/*
 * An ERP names itself on every event it delivers (contract version 4): the integration serving
 * several ERPs matches the message to that ERP's part and key map. The id is the one the
 * integration's ERP list gives this ERP, set at deploy (ERP_ID). Since version 16 it is the
 * CloudEvents envelope's `source`, /erp/<ERP_ID>; an ERP deployed without it speaks as /erp,
 * which the integration reads as its single ERP. The data is never changed for it.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { deliver } = require('../lib/events')

const DATA = { SalesOrder: '0000001000', CreditBlock: true }
const ENTRY = { _id: 'e1', at: '2026-10-02T10:00:00.000Z', type: 'SalesOrder.Changed', data: DATA }

async function sent (params) {
  const calls = []
  const res = await deliver({ EVENTS_WEBHOOK_URL: 'https://x.example/api/v1/web/ingestion/webhook', ...params }, ENTRY, {
    headers: {},
    fetch: async (url, init) => { calls.push(JSON.parse(init.body)); return { ok: true, status: 200 } }
  })
  assert.equal(res.delivered, true)
  return calls[0]
}

test('an ERP deployed with an id names itself as the source of the event it delivers', async () => {
  const body = await sent({ ERP_ID: 'brand-b' })
  assert.equal(body.source, '/erp/brand-b')
  assert.deepEqual(body.data, DATA, 'the data carries no id of the speaker')
  assert.deepEqual(ENTRY.data, { SalesOrder: '0000001000', CreditBlock: true }, 'the journal entry is not changed')
})

test('an ERP deployed without an id speaks as /erp, in the same envelope', async () => {
  const body = await sent({})
  assert.deepEqual(body, { specversion: '1.0', id: 'e1', source: '/erp', type: 'SalesOrder.Changed', time: ENTRY.at, datacontenttype: 'application/json', data: DATA })
})

test('an ERP_ID left unset at deploy is not an id', async () => {
  for (const ERP_ID of ['', '$ERP_ID', 'Not An Id']) {
    const body = await sent({ ERP_ID })
    assert.equal(body.source, '/erp', JSON.stringify(ERP_ID))
  }
})
