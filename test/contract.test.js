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
const { EVENT_TYPES, MAX_ATTEMPTS, pending, envelope } = require('../lib/events')
const { memoryCollections } = require('./helpers/memory-db')
const { importProducts, patchProduct } = require('../lib/products')
const { importPartners, patchPartner } = require('../lib/partners')
const { createOrder, setStatus } = require('../lib/orders')
const { releaseCredit } = require('../lib/fulfilment')
const { createContract, activateContract } = require('../lib/contracts')
const { createReturn, receiveReturn, creditReturn } = require('../lib/returns')
const { postPayment } = require('../lib/payments')

let cols
beforeEach(() => { cols = memoryCollections() })

test('every event type the ERP raises is in the contract, and nothing in the contract is unraised', () => {
  assert.deepEqual([...EVENT_TYPES].sort(), Object.keys(contract.events.types).sort())
})

test('the data of each raised event carries exactly the contract keys, in a CloudEvents envelope, and no web shop name or id', async () => {
  await importProducts(cols, [{ sku: 'A1', name: 'A', listPrice: 10, warehouses: [{ code: 'default', name: 'Default Source', quantity: 5 }] }])
  await importPartners(cols, [{ id: 'C1', name: 'One', commerceCompanyId: '1' }])
  await patchProduct(cols, 'A1', { listPrice: 11, warehouses: [{ code: 'default', quantity: 6 }] })
  // Version 16: an invoice credited in whole is a credit memo with no return.
  const { creditInvoice } = require('../lib/credit-memos')
  const placed = await createOrder(cols, { purchaseOrderByCustomer: '9', partnerId: 'C1', lines: [{ sku: 'A1', qty: 2, price: 11, customerLineReference: '3' }] })
  await setStatus(cols, placed.number, 'confirmed')
  await setStatus(cols, placed.number, 'shipped')
  const order = await setStatus(cols, placed.number, 'invoiced')
  // Version 13: the invoiced line comes back (return.received) and is credited (creditmemo.created).
  const { returnOrder } = await createReturn(cols, { customerReturnReference: '5', orderNumber: order.number, lines: [{ customerLineReference: '3', qty: 1 }] })
  await receiveReturn(cols, returnOrder.number)
  await creditReturn(cols, returnOrder.number)
  // Version 14: what is left open on the invoice is paid (payment.posted).
  await postPayment(cols, order.invoice.number, { amount: 1, reference: 'Check 1' })
  // After the order flow: a blocked customer's new orders are held, and a hold stops Confirm.
  await patchPartner(cols, 'C1', { creditLimit: 5, blocking: 'all' })
  const cancelled = await createOrder(cols, { purchaseOrderByCustomer: '10', lines: [] })
  await setStatus(cols, cancelled.number, 'canceled', undefined, { reason: 'Customer request' })
  // The blocked customer's next order is created and held (hold event, held: true), then released (held: false).
  const held = await createOrder(cols, { purchaseOrderByCustomer: '11', partnerId: 'C1', lines: [{ sku: 'A1', qty: 1, price: 11, customerLineReference: '4' }] })
  assert.equal(held.creditStatus, 'held')
  await releaseCredit(cols, held.number)
  // An active, in-date contract moves the customer's prices in force: contract.changed.
  const agreement = await createContract(cols, { partnerId: 'C1', startingDate: '2026-01-01', lines: [{ sku: 'A1', kind: 'price', price: 9 }] })
  await activateContract(cols, agreement.number)
  const whole = await createOrder(cols, { purchaseOrderByCustomer: '12', lines: [{ sku: 'A1', qty: 1, price: 11, customerLineReference: '5' }] })
  for (const status of ['confirmed', 'shipped', 'invoiced']) await setStatus(cols, whole.number, status)
  await creditInvoice(cols, whole.number)
  const entries = await pending(cols)
  const seen = new Set()
  const documentTypes = new Set()
  for (const e of entries) {
    const spec = contract.events.types[e.type]
    assert.ok(spec, `${e.type} is not in the contract`)
    assert.deepEqual(Object.keys(e.data).sort(), [...spec.data].sort(), `data keys of ${e.type}`)
    if (Array.isArray(e.data.Items) && e.data.Items.length) assert.deepEqual(Object.keys(e.data.Items[0]).sort(), [...contract.events.item].sort())
    if (e.type === 'PriceList.Changed') assert.deepEqual(Object.keys(e.data.Lines[0]).sort(), [...contract.contracts.priceLine].sort())
    if (e.type === 'BillingDocument.Created') documentTypes.add(e.data.BillingDocumentType)
    if (spec.changedFields) for (const field of e.data.ChangedFields) assert.ok(spec.changedFields.includes(field), `${e.type} ${field}`)
    // The envelope a subscriber is sent, as the delivery builds it.
    const sent = envelope(e, { ERP_ID: 'erp-a' })
    assert.deepEqual(Object.keys(sent).sort(), [...contract.delivery.envelope].sort())
    assert.equal(sent.specversion, '1.0')
    assert.equal(sent.source, '/erp/erp-a')
    // The ERP speaks only its own words: nothing a web shop calls things rides along.
    assert.doesNotMatch(JSON.stringify(sent), /commerce|orderId|incrementId|orderItemId|erpId/i, e.type)
    seen.add(e.type)
  }
  assert.deepEqual([...seen].sort(), Object.keys(contract.events.types).sort(), 'every contract event was raised in this test')
  assert.deepEqual([...documentTypes].sort(), [...contract.events.types['BillingDocument.Created'].documentTypes].sort())
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
  // Version 16: a customer event speaks the ERP's own customer number and nothing of the shop's.
  assert.ok(contract.events.types['Customer.Changed'].data.includes('Customer'))
  assert.doesNotMatch(JSON.stringify(contract.events), /commerce/i)
  assert.deepEqual(contract.import.structure, ['websites'])
  assert.deepEqual(contract.import.structureWebsite, ['code', 'name', 'salesOrg', 'salesOrgName', 'storeInfo'])
  for (const key of ['salesOrg', 'salesOrgName']) {
    assert.ok(contract.order.request.includes(key), key)
    assert.ok(contract.order.response.includes(key), key)
  }
})

test('from version 4: a delivered event names its ERP when the ERP was deployed with an id', () => {
  assert.ok(contract.contractVersion >= 4)
  assert.match(contract.delivery.erpId, /source/)
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
  assert.deepEqual(contract.events.types['PriceList.Changed'].data, ['Customer', 'Lines'])
  assert.match(contract.events.types['PriceList.Changed'].note, /whole/)
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
  // A discount line carries percent and no price; a price line price and no percent. Every
  // line carries salesOrg since version 12 (null: for every website).
  assert.deepEqual(contract.contracts.priceLine, ['sku', 'kind', 'price', 'minQty', 'contractNumber', 'appliesTo', 'salesOrg'])
  assert.deepEqual(contract.contracts.discountLine, ['sku', 'kind', 'percent', 'minQty', 'contractNumber', 'appliesTo', 'salesOrg'])
  assert.match(contract.contracts.inForceNote, /price group/)
  assert.match(contract.events.types['PriceList.Changed'].note, /member/)
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

test('from version 9: prices in force are what the ERP would charge, pricing conditions and the ceiling included', async () => {
  assert.ok(contract.contractVersion >= 9)
  assert.match(contract.contracts.inForceNote, /version 9/)
  assert.match(contract.contracts.inForceNote, /pricing condition/)
  assert.match(contract.contracts.inForceNote, /maximum discount/)
  assert.match(contract.contracts.lineNote, /contractNumber is null/)
  assert.match(contract.events.types['PriceList.Changed'].note, /version 9/)
  assert.match(contract.events.types['PriceList.Changed'].note, /list price/)
  // A line a loose condition set keeps the published shape, as the code produces it.
  const { upsertCondition } = require('../lib/conditions')
  await importProducts(cols, [{ sku: 'A1', name: 'A', listPrice: 10 }])
  await importPartners(cols, [{ id: 'C1', name: 'One' }])
  await upsertCondition(cols, { kind: 'contractDiscount', partnerId: 'C1', percent: 10 })
  await upsertCondition(cols, { kind: 'contractPrice', partnerId: 'C1', sku: 'A1', price: 9.5 })
  const [discounted, priced] = (await pending(cols)).filter((e) => e.type === 'PriceList.Changed').map((e) => e.data.Lines[0])
  assert.deepEqual(Object.keys(discounted).sort(), [...contract.contracts.discountLine].sort())
  assert.deepEqual(Object.keys(priced).sort(), [...contract.contracts.priceLine].sort())
  assert.equal(priced.contractNumber, null)
})

test('from version 12: a published line may name its sales organization (AB-46); availability and credit-check are routes with their shapes (v11)', () => {
  assert.ok(contract.contractVersion >= 12)
  assert.ok(contract.contracts.priceLine.includes('salesOrg'))
  assert.ok(contract.contracts.discountLine.includes('salesOrg'))
  assert.match(contract.contracts.lineNote, /version 12: salesOrg/)
  assert.ok(contract.routes.products.includes('POST /availability'))
  assert.ok(contract.routes.partners.includes('POST /:id/credit-check'))
  assert.deepEqual(contract.availability.responseLine, ['sku', 'requested', 'availableNow', 'canPromiseNow', 'promiseDate', 'leadTimeDays'])
  assert.deepEqual(contract.creditCheck.response, ['partnerId', 'status', 'reason', 'requested', 'exposure', 'limit', 'available'])
  // The v10 seed block rides along under 11: it shipped without a bump.
  assert.deepEqual(contract.import.seed, ['priceGroups', 'partnerGroups', 'contracts'])
})

test('since version 10: canceled, order.canceled and Canceled in Commerce, in American English', () => {
  const { CANCEL_REASONS, STATUSES } = require('../lib/orders')
  assert.ok(contract.contractVersion >= 10)
  assert.equal(contract.order.external.cancelReasonFromWebShop, 'Canceled in the web shop')
  assert.ok(CANCEL_REASONS.includes(contract.order.external.cancelReasonFromWebShop))
  assert.ok(contract.events.types['SalesOrder.Changed'])
  assert.ok(STATUSES.includes('canceled'))
  assert.match(contract.order.spellingNote, /refused/)
  assert.doesNotMatch(JSON.stringify(contract).replace(/\(was [^)]*\)/g, ''), /[Cc]ancelled/)
})

test('from version 13: return orders and credit memos, their routes, shapes and two events', async () => {
  assert.ok(contract.contractVersion >= 13)
  assert.ok(contract.routes.orders.includes('POST /:number/credit-memo'))
  assert.deepEqual(contract.routes.returns, ['GET', 'GET /:number', 'POST', 'POST /:number/receive', 'POST /:number/credit-memo'])
  assert.deepEqual(contract.routes['credit-memos'], ['GET', 'GET /:number'])
  assert.deepEqual(contract.returns.statuses, ['open', 'received', 'credited'])
  assert.ok(contract.events.types['BillingDocument.Created'].documentTypes.includes('CreditMemo'))
  assert.ok(contract.events.types['CustomerReturn.Changed'])
  // The documents as the code produces them.
  const { invoke } = require('./helpers/memory-db')
  await importProducts(cols, [{ sku: 'A1', name: 'A', listPrice: 10, warehouses: [{ code: 'default', name: 'Default Source', quantity: 5 }] }])
  const order = await createOrder(cols, { purchaseOrderByCustomer: '9', lines: [{ sku: 'A1', qty: 2, price: 10, customerLineReference: '3' }] })
  for (const status of ['confirmed', 'shipped', 'invoiced']) await setStatus(cols, order.number, status)
  const made = await invoke(require('../actions/returns'), cols, { method: 'POST', body: { customerReturnReference: '5', orderNumber: order.number, lines: [{ customerLineReference: '3', qty: 1 }] } })
  assert.deepEqual(Object.keys(made.body).sort(), [...contract.returns.response].sort())
  assert.deepEqual(Object.keys(made.body.lines[0]).sort(), [...contract.returns.responseLine].sort())
  assert.ok(contract.returns.statuses.includes(made.body.status))
  // The whole-invoice credit memo, in its contract shape: on an order with no open return,
  // since an open return refuses a whole credit.
  const other = await createOrder(cols, { purchaseOrderByCustomer: '10', lines: [{ sku: 'A1', qty: 1, price: 10, customerLineReference: '4' }] })
  for (const status of ['confirmed', 'shipped', 'invoiced']) await setStatus(cols, other.number, status)
  const credited = await invoke(require('../actions/orders'), cols, { method: 'POST', path: `${other.number}/credit-memo` })
  const [memo] = credited.body.creditMemos
  assert.deepEqual(Object.keys(memo).sort(), [...contract.creditMemo.response].sort())
  assert.deepEqual(Object.keys(memo.lines[0]).sort(), [...contract.creditMemo.line].sort())
})

test('from version 14: open items and incoming payments, their routes, shapes and one event', async () => {
  assert.ok(contract.contractVersion >= 14)
  assert.deepEqual(contract.routes.invoices, ['GET', 'GET /:number', 'POST /:number/payments'])
  assert.deepEqual(contract.routes.payments, ['GET', 'GET /:number'])
  assert.ok(contract.events.types['IncomingPayment.Posted'])
  const { PAYMENT_STATUSES } = require('../lib/open-items')
  assert.deepEqual(contract.payments.paymentStatuses, PAYMENT_STATUSES)
  assert.deepEqual(contract.payments.request, ['amount', 'reference'])
  // The documents as the code produces them.
  const { invoke } = require('./helpers/memory-db')
  await importProducts(cols, [{ sku: 'A1', name: 'A', listPrice: 10, warehouses: [{ code: 'default', name: 'Default Source', quantity: 5 }] }])
  const order = await createOrder(cols, { purchaseOrderByCustomer: '9', lines: [{ sku: 'A1', qty: 2, price: 10, customerLineReference: '3' }] })
  for (const status of ['confirmed', 'shipped', 'invoiced']) await setStatus(cols, order.number, status)
  const number = (await invoke(require('../actions/invoices'), cols)).body.items[0].number
  const paid = await invoke(require('../actions/invoices'), cols, { method: 'POST', path: `${number}/payments`, body: { amount: 5, reference: 'Wire 1' } })
  assert.equal(paid.statusCode, 201)
  assert.deepEqual(Object.keys(paid.body).sort(), [...contract.payments.response].sort())
  const read = await invoke(require('../actions/payments'), cols, { path: paid.body.number })
  assert.deepEqual(Object.keys(read.body).sort(), [...contract.payments.response].sort())
  // Every place an invoice is described carries the open item fields, a status from the list.
  const invoice = (await invoke(require('../actions/invoices'), cols, { path: number })).body
  const row = (await invoke(require('../actions/invoices'), cols)).body.items[0]
  for (const described of [invoice, row]) {
    for (const key of contract.payments.invoiceFields) assert.ok(key in described, key)
    assert.ok(contract.payments.paymentStatuses.includes(described.paymentStatus))
  }
  assert.equal(invoice.paymentStatus, 'partly paid')
})

test('from version 15: the ERP\'s setup, its routes and shapes as the code answers them, and a return line\'s reason code', async () => {
  assert.ok(contract.contractVersion >= 15)
  for (const route of ['GET', 'PATCH', 'GET /setup', 'PATCH /setup', 'POST /sales-organizations', 'PATCH /sales-organizations/:code', 'POST /maintenance', 'DELETE /maintenance']) {
    assert.ok(contract.routes.settings.includes(route), route)
  }
  const { CREDIT_WARNINGS } = require('../lib/credit')
  assert.deepEqual(contract.settings.creditWarnings, CREDIT_WARNINGS)
  assert.match(contract.settings.note, /version 15/)
  // The setup as the code answers it.
  const { invoke } = require('./helpers/memory-db')
  const setup = (await invoke(require('../actions/settings'), cols, { path: '/setup' })).body
  assert.deepEqual(Object.keys(setup).sort(), [...contract.settings.setup].sort())
  assert.deepEqual(Object.keys(setup.company).sort(), [...contract.settings.company].sort())
  assert.deepEqual(Object.keys(setup.sales).sort(), [...contract.settings.sales].sort())
  assert.deepEqual(Object.keys(setup.sales.returnReasons[0]).sort(), [...contract.settings.returnReason].sort())
  assert.deepEqual(Object.keys(setup.numberSeries[0]).sort(), [...contract.settings.numberSeriesRow].sort())
  assert.deepEqual(setup.numberSeries.map((s) => s.type), contract.settings.numberSeriesTypes)
  const added = (await invoke(require('../actions/settings'), cols, { method: 'POST', path: '/sales-organizations', body: { code: '1000', name: 'Home', currency: 'USD' } })).body
  assert.deepEqual(Object.keys(added.salesOrganizations[0]).sort(), [...contract.settings.salesOrganization].sort())
  // A return line carries the reason code it was coded with.
  assert.ok(contract.returns.responseLine.includes('reasonCode'))
})

test('the contract is at version 16: the ERP speaks its own language — CloudEvents of its own types, and the customer\'s references where the shop\'s ids were', async () => {
  assert.equal(contract.contractVersion, 16)
  assert.deepEqual(contract.delivery.envelope, ['specversion', 'id', 'source', 'type', 'time', 'datacontenttype', 'data'])
  assert.ok(contract.order.request.includes('purchaseOrderByCustomer'))
  assert.ok(contract.order.requestLine.includes('customerLineReference'))
  assert.ok(contract.returns.request.includes('customerReturnReference'))
  assert.ok(contract.routes.orders.includes('POST /:number/external-shipment'))
  assert.ok(contract.routes.orders.includes('POST /:number/external-invoice'))
  assert.deepEqual(contract.order.external.origin, ['system', 'document', 'eventId'])
  // No web shop name in what the ERP accepts or answers, nor in what it publishes.
  for (const shape of [contract.order, contract.returns, contract.creditMemo, contract.events, contract.delivery]) {
    assert.doesNotMatch(JSON.stringify(shape).replace(/"[^"]*Note"\s*:\s*"[^"]*"/g, ''), /commerce[A-Z]|commerce-/)
  }
  // The routes as the code answers them: an order created by the customer's reference answers it.
  const { invoke } = require('./helpers/memory-db')
  await importProducts(cols, [{ sku: 'A1', name: 'A', listPrice: 10, warehouses: [{ code: 'default', name: 'Default Source', quantity: 5 }] }])
  const made = await invoke(require('../actions/orders'), cols, { method: 'POST', body: { purchaseOrderByCustomer: '000000042', lines: [{ sku: 'A1', qty: 1, price: 10, customerLineReference: '7' }] } })
  assert.equal(made.statusCode, 201)
  assert.deepEqual(Object.keys(made.body).filter((k) => contract.order.response.includes(k)).sort(), [...contract.order.response].sort())
  assert.equal(made.body.purchaseOrderByCustomer, '000000042')
  assert.equal(made.body.lines[0].customerLineReference, '7')
})
