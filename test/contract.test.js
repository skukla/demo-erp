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
const { releaseCredit } = require('../lib/fulfilment')
const { createContract, activateContract } = require('../lib/contracts')

let cols
beforeEach(() => { cols = memoryCollections() })

test('every event the ERP raises is in the contract, and nothing in the contract is unraised', () => {
  const raised = Object.fromEntries(Object.entries(EVENT_NAMES).map(([kind, name]) => [name, kind]))
  assert.deepEqual(Object.keys(raised).sort(), Object.keys(contract.events).sort())
  for (const [name, spec] of Object.entries(contract.events)) assert.equal(spec.raisedBy, raised[name])
})

test('the payload of each raised event carries exactly the contract keys', async () => {
  await importProducts(cols, [{ sku: 'A1', name: 'A', listPrice: 10, warehouses: [{ code: 'default', name: 'Default Source', quantity: 5 }] }])
  await importPartners(cols, [{ id: 'C1', name: 'One', commerceCompanyId: '1' }])
  await patchProduct(cols, 'A1', { listPrice: 11, warehouses: [{ code: 'default', quantity: 6 }] })
  const order = await createOrder(cols, { commerceOrderId: '9', partnerId: 'C1', lines: [{ sku: 'A1', qty: 1, price: 11, commerceItemId: 3 }] })
  await setStatus(cols, order.number, 'confirmed')
  await setStatus(cols, order.number, 'shipped')
  await setStatus(cols, order.number, 'invoiced')
  // After the order flow: a blocked customer's new orders are held, and a hold stops Confirm.
  await patchPartner(cols, 'C1', { creditLimit: 5, blocking: 'all' })
  const cancelled = await createOrder(cols, { commerceOrderId: '10', lines: [] })
  await setStatus(cols, cancelled.number, 'cancelled', undefined, { reason: 'Customer request' })
  // The blocked customer's next order is created and held (hold event, held: true), then released (held: false).
  const held = await createOrder(cols, { commerceOrderId: '11', partnerId: 'C1', lines: [{ sku: 'A1', qty: 1, price: 11, commerceItemId: 4 }] })
  assert.equal(held.creditStatus, 'held')
  await releaseCredit(cols, held.number)
  // An active, in-date contract moves the customer's prices in force: contract.changed.
  const agreement = await createContract(cols, { partnerId: 'C1', startingDate: '2026-01-01', lines: [{ sku: 'A1', kind: 'price', price: 9 }] })
  await activateContract(cols, agreement.number)
  const entries = await pending(cols)
  const seen = new Set()
  for (const e of entries) {
    const spec = contract.events[e.event]
    assert.ok(spec, `${e.event} is not in the contract`)
    const sample = spec.valueIsArray ? e.value[0] : e.value
    assert.deepEqual(Object.keys(sample).sort(), [...spec.value].sort(), `payload keys of ${e.event}`)
    if (Array.isArray(sample.items) && sample.items.length) assert.deepEqual(Object.keys(sample.items[0]).sort(), [...contract.orderEventItem].sort())
    if (spec.raisedBy === 'contract.changed') assert.deepEqual(Object.keys(sample.lines[0]).sort(), [...contract.contracts.priceLine].sort())
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

test('from version 3 the business-structure fields are named on partners, orders and the structure import, and no Commerce id is', () => {
  assert.ok(contract.contractVersion >= 3)
  for (const key of ['salesOrgs', 'legalName', 'vatTaxId', 'resellerId', 'legalAddress']) assert.ok(contract.import.partners.includes(key), key)
  // Version 3: the ERP holds and speaks no Commerce id; the integration keeps the key map.
  for (const key of ['commerceCompanyId', 'customerGroupId', 'emailDomain', 'website']) assert.ok(!contract.import.partners.includes(key), key)
  for (const key of ['commerceCompanyId', 'customerGroupId', 'email']) {
    assert.ok(!contract.order.request.includes(key), key)
    assert.ok(!contract.quote.request.includes(key), key)
  }
  assert.deepEqual(contract.events['be-observer.company_credit_update'].value, ['partnerId', 'creditLimit'])
  assert.deepEqual(contract.events['be-observer.company_status_update'].value, ['partnerId', 'blocked'])
  assert.deepEqual(contract.import.structure, ['websites'])
  assert.deepEqual(contract.import.structureWebsite, ['code', 'name', 'salesOrg', 'salesOrgName', 'storeInfo'])
  for (const key of ['salesOrg', 'salesOrgName']) {
    assert.ok(contract.order.request.includes(key), key)
    assert.ok(contract.order.response.includes(key), key)
  }
})

test('from version 4: a delivered event names its ERP when the ERP was deployed with an id', () => {
  assert.ok(contract.contractVersion >= 4)
  assert.match(contract.delivery.erpId, /erpId/)
  assert.match(contract.delivery.erpId, /ERP_ID/)
})

test('from version 5: the import carries Commerce\'s switch as the website account, never the ERP\'s credit block', () => {
  assert.ok(contract.contractVersion >= 5)
  assert.ok(contract.import.partners.includes('websiteAccountClosed'))
  assert.ok(!contract.import.partners.includes('blocked'))
  assert.match(contract.import.partnersNote, /never changes the ERP's own credit block/)
})

test('from version 6: the ERP holds price lists (route contracts), publishes their prices in force, and says when they change', () => {
  assert.ok(contract.contractVersion >= 6)
  for (const route of ['GET', 'GET /in-force', 'GET /:number', 'POST', 'PATCH /:number', 'POST /:number/activate', 'POST /:number/deactivate']) assert.ok(contract.routes.contracts.includes(route), route)
  assert.equal(contract.events['be-observer.company_contract_update'].raisedBy, 'contract.changed')
  assert.deepEqual(contract.events['be-observer.company_contract_update'].value, ['partnerId', 'lines'])
  assert.match(contract.events['be-observer.company_contract_update'].note, /whole/)
  assert.deepEqual(contract.contracts.inForce, ['items'])
  assert.deepEqual(contract.contracts.inForceItem, ['partnerId', 'lines'])
  assert.ok(contract.quote.responseLine.includes('contractNumber'))
})

test('from version 7: price groups, lists for a customer or a group, dated lines, and where each line in force came from', () => {
  assert.ok(contract.contractVersion >= 7)
  for (const route of ['GET /price-groups', 'POST /price-groups', 'DELETE /price-groups/:code']) assert.ok(contract.routes.contracts.includes(route), route)
  assert.deepEqual(contract.contracts.appliesTo, ['customer', 'priceGroup'])
  assert.deepEqual(contract.contracts.contract, ['number', 'appliesTo', 'partnerId', 'priceGroup', 'description', 'startingDate', 'endingDate', 'status', 'lines', 'createdAt', 'updatedAt'])
  assert.deepEqual(contract.contracts.line, ['sku', 'kind', 'price', 'percent', 'minQty', 'startingDate', 'endingDate'])
  assert.deepEqual(contract.contracts.priceGroup, ['code', 'name'])
  // A discount line carries percent and no price; a price line price and no percent.
  assert.deepEqual(contract.contracts.priceLine, ['sku', 'kind', 'price', 'minQty', 'contractNumber', 'appliesTo'])
  assert.deepEqual(contract.contracts.discountLine, ['sku', 'kind', 'percent', 'minQty', 'contractNumber', 'appliesTo'])
  assert.match(contract.contracts.inForceNote, /price group/)
  assert.match(contract.events['be-observer.company_contract_update'].note, /member/)
})

test('from version 8: the maintenance window, which routes stay open in it, and what the others answer', async () => {
  assert.ok(contract.contractVersion >= 8)
  assert.ok(contract.routes.settings.includes('POST /maintenance'))
  assert.ok(contract.routes.settings.includes('DELETE /maintenance'))
  // The open actions are the ones that say so in code, and no others.
  const open = Object.keys(contract.routes).filter((name) => require(`../actions/${name}`).openInMaintenance).sort()
  assert.deepEqual(open, [...contract.maintenance.openRoutes].sort())
  // Health's field, and the refusal every other route gives, as the code produces them.
  const { invoke } = require('./helpers/memory-db')
  await invoke(require('../actions/settings'), cols, { method: 'POST', path: '/maintenance' })
  const health = await invoke(require('../actions/health'), cols)
  assert.deepEqual(Object.keys(health.body.maintenance).sort(), [...contract.maintenance.health].sort())
  const refused = await invoke(require('../actions/products'), cols)
  assert.equal(refused.statusCode, contract.maintenance.refusal.statusCode)
  assert.equal(refused.body.errorCode, contract.maintenance.refusal.errorCode)
  assert.deepEqual(Object.keys(refused.body).sort(), [...contract.maintenance.refusal.body].sort())
})

test('the contract is at version 9: prices in force are what the ERP would charge, pricing conditions and the ceiling included', async () => {
  assert.equal(contract.contractVersion, 9)
  assert.match(contract.contracts.inForceNote, /version 9/)
  assert.match(contract.contracts.inForceNote, /pricing condition/)
  assert.match(contract.contracts.inForceNote, /maximum discount/)
  assert.match(contract.contracts.lineNote, /contractNumber is null/)
  assert.match(contract.events['be-observer.company_contract_update'].note, /version 9/)
  assert.match(contract.events['be-observer.company_contract_update'].note, /list price/)
  // A line a loose condition set keeps the published shape, as the code produces it.
  const { upsertCondition } = require('../lib/conditions')
  await importProducts(cols, [{ sku: 'A1', name: 'A', listPrice: 10 }])
  await importPartners(cols, [{ id: 'C1', name: 'One' }])
  await upsertCondition(cols, { kind: 'contractDiscount', partnerId: 'C1', percent: 10 })
  await upsertCondition(cols, { kind: 'contractPrice', partnerId: 'C1', sku: 'A1', price: 9.5 })
  const [discounted, priced] = (await pending(cols)).filter((e) => e.kind === 'contract.changed').map((e) => e.value.lines[0])
  assert.deepEqual(Object.keys(discounted).sort(), [...contract.contracts.discountLine].sort())
  assert.deepEqual(Object.keys(priced).sort(), [...contract.contracts.priceLine].sort())
  assert.equal(priced.contractNumber, null)
})
