/*
 * Live credit check at order placement (AB-20): the ERP owns the credit limit, so checkout
 * asks it — before the order is committed — "can this partner carry this amount now?". Unlike
 * createOrder, which creates the order and HOLDS it (§6.1), this answers WITHOUT creating
 * anything, so Commerce can refuse checkout. The verdict is credit's own decide(); this only
 * adds the numbers a shopper acts on (limit, exposure, what is left).
 */
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { memoryCollections, invoke } = require('./helpers/memory-db')
const { importPartners, ensureDefaultPartner, patchPartner, getPartner } = require('../lib/partners')
const { importProducts } = require('../lib/products')
const { createOrder } = require('../lib/orders')
const { assessCredit } = require('../lib/credit')
const partners = require('../actions/partners')

test('assessCredit approves within the limit and reports the numbers', () => {
  const partner = { id: 'C1', creditLimit: 1000, blocking: 'open', websiteAccount: 'active' }
  assert.deepEqual(assessCredit({ partner, exposure: 200, net: 300, currency: 'USD' }), {
    partnerId: 'C1', status: 'approved', reason: null, requested: 300, exposure: 200, limit: 1000, available: 800
  })
})

test('assessCredit holds when the amount takes exposure past the limit, with the reason in words', () => {
  const partner = { id: 'C1', creditLimit: 1000, blocking: 'open', websiteAccount: 'active' }
  const res = assessCredit({ partner, exposure: 600, net: 500, currency: 'USD' })
  assert.equal(res.status, 'held')
  assert.equal(res.reason, 'Credit limit USD 1,000.00 exceeded by USD 100.00')
  assert.equal(res.available, 400)
})

test('assessCredit holds a blocked customer regardless of the amount', () => {
  const partner = { id: 'C1', creditLimit: 100000, blocking: 'shipping', websiteAccount: 'active' }
  assert.equal(assessCredit({ partner, exposure: 0, net: 1, currency: 'USD' }).status, 'held')
})

test('assessCredit gives the walk-in customer no credit relationship: null status, null limit and available', () => {
  const walkin = { id: 'P000000', isDefault: true }
  assert.deepEqual(assessCredit({ partner: walkin, exposure: 0, net: 500 }), {
    partnerId: 'P000000', status: null, reason: null, requested: 500, exposure: 0, limit: null, available: null
  })
})

let cols
beforeEach(async () => {
  cols = memoryCollections()
  await importProducts(cols, [{ sku: 'A1', name: 'Trouser', listPrice: 100, warehouses: [{ code: 'default', name: 'Default Source', quantity: 50 }] }])
  await importPartners(cols, [{ id: 'C1', name: 'Acme', creditLimit: 1000 }])
  await ensureDefaultPartner(cols, 'Demo')
})

test('POST partners/:id/credit-check reads the partner exposure live and answers the placement question', async () => {
  // An open order of 600 is already exposure; a new 300 fits under 1,000, a new 500 does not.
  await createOrder(cols, { purchaseOrderByCustomer: '1', partnerId: 'C1', lines: [{ sku: 'A1', qty: 6, price: 100, customerLineReference: '1' }] })
  const ok = await invoke(partners, cols, { method: 'POST', path: '/C1/credit-check', body: { net: 300 } })
  assert.equal(ok.statusCode, 200)
  assert.equal(ok.body.status, 'approved')
  assert.equal(ok.body.exposure, 600)
  assert.equal(ok.body.available, 400)
  const over = await invoke(partners, cols, { method: 'POST', path: '/C1/credit-check', body: { net: 500 } })
  assert.equal(over.body.status, 'held')
  assert.equal(over.body.reason, 'Credit limit USD 1,000.00 exceeded by USD 100.00')
})

test('the live check reflects an ERP-side block placed since the number was synced', async () => {
  await patchPartner(cols, 'C1', { blocking: 'all' })
  const res = await invoke(partners, cols, { method: 'POST', path: '/C1/credit-check', body: { net: 1 } })
  assert.equal(res.body.status, 'held')
  assert.match(res.body.reason, /blocked for all business/)
})

test('an unknown customer is a 404', async () => {
  const res = await invoke(partners, cols, { method: 'POST', path: '/NOPE/credit-check', body: { net: 1 } })
  assert.equal(res.statusCode, 404)
})
