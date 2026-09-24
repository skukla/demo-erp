/*
 * Credit that works (plan §6.1). SAP does not refuse an over-limit order: it creates it and
 * blocks it, and a person releases or rejects it. A hold stops the NEXT document — Confirm
 * and Create shipment are refused, in words — and two actions clear it. Blocking is
 * graduated the way Business Central's is: Open · Shipping · Invoicing · All.
 *
 * Everything here is absent for a customer with no Commerce company: no credit, no hold.
 */
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { memoryCollections, invoke } = require('./helpers/memory-db')
const { importPartners, ensureDefaultPartner, patchPartner, getPartner, describePartner, BLOCKING } = require('../lib/partners')
const { createOrder, describeOrder, getOrder } = require('../lib/orders')
const { confirmOrder, createShipment, postShipment, createInvoice, releaseCredit, rejectCredit } = require('../lib/fulfilment')
const { importProducts } = require('../lib/products')
const { pending } = require('../lib/events')
const orders = require('../actions/orders')
const partners = require('../actions/partners')

let cols
beforeEach(async () => {
  cols = memoryCollections()
  await importProducts(cols, [{ sku: 'A1', name: 'Trouser', listPrice: 100, warehouses: [{ code: 'default', name: 'Default Source', quantity: 50 }] }])
  await importPartners(cols, [{ id: 'C1', name: 'Acme', commerceCompanyId: '7', creditLimit: 1000 }])
  await ensureDefaultPartner(cols, 'Demo')
})

const order = (id, qty, price = 100) => ({ commerceOrderId: id, partnerId: 'C1', lines: [{ sku: 'A1', qty, price, commerceItemId: 1 }] })

test('an order within the limit is approved; one that takes exposure past it is CREATED and HELD, with the reason in words', async () => {
  const fine = await createOrder(cols, order('1', 6))
  assert.equal(fine.creditStatus, 'approved')
  const over = await createOrder(cols, order('2', 5))
  assert.equal(over.status, 'created')
  assert.equal(over.creditStatus, 'held')
  // Exposure was 600 (order 1, uninvoiced) + this order's 500 = 1,100 against 1,000.
  assert.equal(over.creditReason, 'Credit limit 1,000.00 exceeded by 100.00')
  assert.equal(await cols.salesOrders.countDocuments({}), 2)
})

test('a customer blocked for shipping or for all business gets held orders; blocked for invoicing does too; open does not', async () => {
  for (const [level, held] of [['shipping', true], ['invoicing', true], ['all', true], ['open', false]]) {
    await patchPartner(cols, 'C1', { blocking: level })
    const o = await createOrder(cols, order(`b-${level}`, 1))
    assert.equal(o.creditStatus, held ? 'held' : 'approved', level)
    if (held) assert.match(o.creditReason, /Customer blocked/)
  }
})

test('the walk-in customer, and any customer without a Commerce company, is never held and has no credit status', async () => {
  const o = await createOrder(cols, { commerceOrderId: 'w', partnerId: 'P000000', lines: [{ sku: 'A1', qty: 500, price: 100 }] })
  assert.equal(o.creditStatus, null)
  const doc = await describeOrder(cols, o)
  assert.equal(doc.credit, null)
  assert.equal(doc.can.confirm, true)
})

test('a held order refuses to confirm, and says what to do; Release clears it and Confirm then works', async () => {
  await createOrder(cols, order('1', 6))
  const held = await createOrder(cols, order('2', 5))
  await assert.rejects(confirmOrder(cols, held.number), /Credit limit 1,000.00 exceeded by 100.00\. Release the order first\./)
  const doc = await describeOrder(cols, await getOrder(cols, held.number))
  assert.equal(doc.can.confirm, false)
  assert.equal(doc.can.release, true)
  assert.equal(doc.can.reject, true)
  const released = await releaseCredit(cols, held.number)
  assert.equal(released.creditStatus, 'released')
  assert.ok(released.creditDecidedAt)
  const confirmed = await confirmOrder(cols, held.number)
  assert.equal(confirmed.header, 'confirmed')
  const after = await describeOrder(cols, confirmed)
  assert.equal(after.can.release, false)
  assert.equal(after.credit.status, 'released')
})

test('Reject cancels the held order with the reason "Credit rejected", and Commerce hears the cancel', async () => {
  await createOrder(cols, order('1', 6))
  const held = await createOrder(cols, order('2', 5))
  const rejected = await rejectCredit(cols, held.number)
  assert.equal(rejected.header, 'cancelled')
  assert.equal(rejected.cancelReason, 'Credit rejected')
  assert.equal(rejected.creditStatus, 'held')
  const cancel = (await pending(cols)).find((e) => e.kind === 'order.cancelled')
  assert.equal(cancel.value.reason, 'Credit rejected')
  await assert.rejects(releaseCredit(cols, held.number), /cancelled/)
})

test('raising the credit limit does NOT release a held order — a release is a decision someone makes', async () => {
  await createOrder(cols, order('1', 6))
  const held = await createOrder(cols, order('2', 5))
  await patchPartner(cols, 'C1', { creditLimit: 100000 })
  assert.equal((await getOrder(cols, held.number)).creditStatus, 'held')
})

test('release and reject refuse an order that is not held', async () => {
  const fine = await createOrder(cols, order('1', 1))
  await assert.rejects(releaseCredit(cols, fine.number), /not on credit hold/)
  await assert.rejects(rejectCredit(cols, fine.number), /not on credit hold/)
})

test('blocking stops the next document: Shipping refuses new shipments but lets an existing one invoice; Invoicing refuses invoices; Open allows all', async () => {
  const o = await createOrder(cols, order('1', 2))
  await confirmOrder(cols, o.number)
  await createShipment(cols, o.number, { lines: [{ item: 10, qty: 1 }] })
  await postShipment(cols, o.number, '8000000001')

  await patchPartner(cols, 'C1', { blocking: 'shipping' })
  await assert.rejects(createShipment(cols, o.number, { lines: [{ item: 10, qty: 1 }] }), /Customer C1 is blocked for shipping/)
  // The remaining line is closed so the order can invoice; a shipping block lets it.
  const { closeRemaining, CLOSE_REASONS } = require('../lib/fulfilment')
  await closeRemaining(cols, o.number, 10, CLOSE_REASONS[0])

  await patchPartner(cols, 'C1', { blocking: 'invoicing' })
  await assert.rejects(createInvoice(cols, o.number), /Customer C1 is blocked for invoicing/)

  await patchPartner(cols, 'C1', { blocking: 'all' })
  await assert.rejects(createInvoice(cols, o.number), /blocked for all business/)

  await patchPartner(cols, 'C1', { blocking: 'open' })
  const invoiced = await createInvoice(cols, o.number)
  assert.ok(invoiced.invoice)
})

test('the blocking level replaces the boolean: Commerce\'s blocked flag imports as All, a legacy record reads as All, and the event keeps sending a boolean', async () => {
  await importPartners(cols, [{ id: 'C2', name: 'Beta', commerceCompanyId: '8', blocked: true }])
  assert.equal((await getPartner(cols, 'C2')).blocking, 'all')
  assert.equal('blocked' in (await getPartner(cols, 'C2')), false)
  await importPartners(cols, [{ id: 'C2', name: 'Beta', commerceCompanyId: '8', blocked: false }])
  assert.equal((await getPartner(cols, 'C2')).blocking, 'open')

  const legacy = { _id: 'C9', id: 'C9', name: 'Old', salesOrg: '1000', commerceCompanyId: '9', customerGroupId: null, emailDomain: null, paymentTerms: 'NET30', creditLimit: 10, blocked: true, updatedAt: 'x' }
  await cols.businessPartners.replaceOne({ _id: 'C9' }, legacy, { upsert: true })
  assert.equal((await getPartner(cols, 'C9')).blocking, 'all')

  await patchPartner(cols, 'C1', { blocking: 'shipping' })
  await patchPartner(cols, 'C1', { blocking: 'invoicing' })
  await patchPartner(cols, 'C1', { blocking: 'open' })
  const events = (await pending(cols)).filter((e) => e.kind === 'partner.blocked')
  // shipping → blocked:true; invoicing changes the level but not the boolean → no event; open → blocked:false
  assert.deepEqual(events.map((e) => e.value.blocked), [true, false])
  assert.deepEqual(Object.keys(events[0].value).sort(), ['blocked', 'companyId', 'partnerId'])
  await assert.rejects(patchPartner(cols, 'C1', { blocking: 'sometimes' }), /blocking must be one of/)
  assert.deepEqual(BLOCKING, ['open', 'shipping', 'invoicing', 'all'])
})

test('the customer document carries the blocking level and its held orders; the order document carries the credit decision', async () => {
  await createOrder(cols, order('1', 6))
  const held = await createOrder(cols, order('2', 5))
  const customer = await describePartner(cols, await getPartner(cols, 'C1'))
  assert.equal(customer.blocking, 'open')
  assert.deepEqual(customer.orders.map((o) => o.creditStatus), ['held', 'approved'])
  assert.equal(customer.credit.held, 1)
  const doc = await describeOrder(cols, await getOrder(cols, held.number))
  assert.deepEqual(doc.credit, { status: 'held', reason: 'Credit limit 1,000.00 exceeded by 100.00', decidedAt: null })
})

test('an order stored before credit existed reads as approved', async () => {
  const legacy = { _id: '0000000900', number: '0000000900', commerceOrderId: '9', partnerId: 'C1', lines: [{ sku: 'A1', qty: 1, price: 10 }], currency: 'USD', total: 10, status: 'confirmed', history: [], createdAt: 'x' }
  await cols.salesOrders.replaceOne({ _id: legacy._id }, legacy, { upsert: true })
  assert.equal((await getOrder(cols, '0000000900')).creditStatus, 'approved')
})

test('the routes: release and reject on the order; blocking on the customer', async () => {
  await createOrder(cols, order('1', 6))
  const held = await createOrder(cols, order('2', 5))
  const res = await invoke(orders, cols, { method: 'POST', path: `/${held.number}/credit/release` })
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.credit.status, 'released')
  const other = await createOrder(cols, order('3', 50))
  const rejected = await invoke(orders, cols, { method: 'POST', path: `/${other.number}/credit/reject` })
  assert.equal(rejected.body.status, 'cancelled')
  const level = await invoke(partners, cols, { method: 'PATCH', path: '/C1', body: { blocking: 'shipping' } })
  assert.equal(level.body.blocking, 'shipping')
  assert.equal((await invoke(partners, cols, { method: 'PATCH', path: '/C1', body: { blocking: 'nope' } })).statusCode, 400)
})
