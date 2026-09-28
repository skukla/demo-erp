/*
 * An ERP names itself on every event it delivers (contract version 4): the integration serving
 * several ERPs matches the message to that ERP's part and key map. The id is the one the
 * integration's ERP list gives this ERP, set at deploy (ERP_ID). An ERP deployed without it
 * sends exactly what it always sent, and the integration reads it as its single ERP.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { deliver } = require('../lib/events')

const ENTRY = { _id: 'e1', event: 'be-observer.sales_order_hold', value: { orderId: 55, erpNumber: '0000001000', held: true } }

async function sent (params) {
  const calls = []
  const res = await deliver({ EVENTS_WEBHOOK_URL: 'https://x.example/api/v1/web/ingestion/webhook', ...params }, ENTRY, {
    headers: {},
    fetch: async (url, init) => { calls.push(JSON.parse(init.body)); return { ok: true, status: 200 } }
  })
  assert.equal(res.delivered, true)
  return calls[0].data
}

test('an ERP deployed with an id names itself on the event it delivers', async () => {
  const data = await sent({ ERP_ID: 'brand-b' })
  assert.deepEqual(data.value, { ...ENTRY.value, erpId: 'brand-b' })
  assert.deepEqual(ENTRY.value, { orderId: 55, erpNumber: '0000001000', held: true }, 'the journal entry is not changed')
})

test('an ERP deployed without an id sends exactly what it always sent', async () => {
  const data = await sent({})
  assert.deepEqual(data, { uid: 'e1', event: ENTRY.event, value: ENTRY.value })
})

test('an ERP_ID left unset at deploy is not an id', async () => {
  for (const ERP_ID of ['', '$ERP_ID']) {
    const data = await sent({ ERP_ID })
    assert.deepEqual(data.value, ENTRY.value, JSON.stringify(ERP_ID))
  }
})

test('a list-valued event keeps its list shape when the ERP has an id', async () => {
  const stock = [{ sku: 'A1', source: 'default', quantity: 3, outOfStock: false }]
  const calls = []
  await deliver({ EVENTS_WEBHOOK_URL: 'https://x.example/api/v1/web/ingestion/webhook', ERP_ID: 'brand-b' },
    { _id: 'e2', event: 'be-observer.catalog_stock_update', value: stock }, {
      headers: {},
      fetch: async (url, init) => { calls.push(JSON.parse(init.body)); return { ok: true, status: 200 } }
    })
  assert.deepEqual(calls[0].data.value, stock, 'a stock line is routed by the product that owns it, so it carries no erpId')
})
