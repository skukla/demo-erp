/*
 * The contract file is what the Commerce integration vendors and tests against. These
 * tests keep the ERP honest to it: every event it can raise is in the contract with the
 * payload keys the contract lists, every route the contract names exists, and the
 * delivery rules match.
 */
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const contract = require('../contract/erp-contract.json')
const { EVENT_NAMES, MAX_ATTEMPTS, pending } = require('../lib/events')
const { memoryCollections } = require('./helpers/memory-db')
const { importProducts, patchProduct } = require('../lib/products')
const { importPartners, patchPartner } = require('../lib/partners')
const { createOrder, setStatus } = require('../lib/orders')

let cols
beforeEach(() => { cols = memoryCollections() })

test('every event the ERP raises is in the contract, and nothing in the contract is unraised', () => {
  const raised = Object.fromEntries(Object.entries(EVENT_NAMES).map(([kind, name]) => [name, kind]))
  assert.deepEqual(Object.keys(raised).sort(), Object.keys(contract.events).sort())
  for (const [name, spec] of Object.entries(contract.events)) assert.equal(spec.raisedBy, raised[name])
})

test('the payload of each raised event carries exactly the contract keys', async () => {
  await importProducts(cols, [{ sku: 'A1', name: 'A', listPrice: 10, stock: 5 }])
  await importPartners(cols, [{ id: 'C1', name: 'One', commerceCompanyId: '1' }])
  await patchProduct(cols, 'A1', { listPrice: 11, stock: 6 })
  await patchPartner(cols, 'C1', { creditLimit: 5, blocked: true })
  const order = await createOrder(cols, { commerceOrderId: '9', partnerId: 'C1', lines: [{ sku: 'A1', qty: 1, price: 11, commerceItemId: 3 }] })
  await setStatus(cols, order.number, 'confirmed')
  await setStatus(cols, order.number, 'shipped')
  await setStatus(cols, order.number, 'invoiced')
  const cancelled = await createOrder(cols, { commerceOrderId: '10', lines: [] })
  await setStatus(cols, cancelled.number, 'cancelled')
  const entries = await pending(cols)
  const seen = new Set()
  for (const e of entries) {
    const spec = contract.events[e.event]
    assert.ok(spec, `${e.event} is not in the contract`)
    const sample = spec.valueIsArray ? e.value[0] : e.value
    assert.deepEqual(Object.keys(sample).sort(), [...spec.value].sort(), `payload keys of ${e.event}`)
    if (Array.isArray(sample.items) && sample.items.length) assert.deepEqual(Object.keys(sample.items[0]).sort(), [...contract.orderEventItem].sort())
    seen.add(e.event)
  }
  assert.deepEqual([...seen].sort(), Object.keys(contract.events).sort(), 'every contract event was raised in this test')
})

// Actions no subscriber calls. The screen serves the ERP's own page to a person
// holding Demo Builder's link; it promises a subscriber nothing.
const NOT_FOR_SUBSCRIBERS = new Set(['screen'])

test('every route in the contract has an action, and every action is in the contract', () => {
  const actions = fs.readdirSync(path.join(__dirname, '..', 'actions')).filter((a) => !NOT_FOR_SUBSCRIBERS.has(a)).sort()
  assert.deepEqual(actions, Object.keys(contract.routes).sort())
})

test('delivery rules match the code', () => {
  assert.equal(contract.delivery.maxAttempts, MAX_ATTEMPTS)
  const { webhookUrl } = require('../lib/events')
  assert.ok(webhookUrl({ EVENTS_WEBHOOK_URL: 'https://x.example' + contract.delivery.webhookPath }).endsWith(contract.delivery.webhookPath))
})
