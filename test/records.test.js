const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { memoryCollections } = require('./helpers/memory-db')
const { importProducts, patchProduct, listProducts } = require('../lib/products')
const { importPartners, ensureDefaultPartner, resolvePartner, patchPartner, getPartner, DEFAULT_PARTNER_ID } = require('../lib/partners')
const { upsertCondition, deleteCondition, listConditions } = require('../lib/conditions')
const { pending } = require('../lib/events')
const { wipe } = require('../lib/admin')
const { getSettings, updateSettings } = require('../lib/settings')

let cols
beforeEach(() => { cols = memoryCollections() })

test('import creates then updates; what Commerce sends wins, what it omits keeps its ERP value', async () => {
  const first = await importProducts(cols, [{ sku: 'A1', name: 'Widget', listPrice: 10, stock: 5 }])
  assert.deepEqual(first, { created: 1, updated: 0 })
  await patchProduct(cols, 'A1', { listPrice: 12, stock: 9 })
  const second = await importProducts(cols, [{ sku: 'A1', name: 'Widget v2', listPrice: 10 }])
  assert.deepEqual(second, { created: 0, updated: 1 })
  const [product] = await listProducts(cols)
  assert.equal(product.name, 'Widget v2')
  assert.equal(product.listPrice, 10)
  assert.equal(product.stock, 9)
})

test('a partner re-import takes the credit limit and block Commerce reports', async () => {
  await importPartners(cols, [{ id: 'C2', name: 'Kukla', creditLimit: 100 }])
  await patchPartner(cols, 'C2', { creditLimit: 500, blocked: true, paymentTerms: 'NET60' })
  await importPartners(cols, [{ id: 'C2', name: 'Kukla Studios', creditLimit: 250, blocked: false }])
  const partner = await getPartner(cols, 'C2')
  assert.equal(partner.name, 'Kukla Studios')
  assert.equal(partner.creditLimit, 250)
  assert.equal(partner.blocked, false)
  assert.equal(partner.paymentTerms, 'NET60')
})

test('a price or stock edit raises exactly one ERP event per changed field', async () => {
  await importProducts(cols, [{ sku: 'A1', listPrice: 10, stock: 5 }])
  await patchProduct(cols, 'A1', { listPrice: 10, stock: 7 })
  const entries = await pending(cols)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].event, 'be-observer.catalog_stock_update')
  assert.deepEqual(entries[0].value, [{ sku: 'A1', source: 'default', quantity: 7, outOfStock: false }])
})

test('bad product values are refused', async () => {
  await importProducts(cols, [{ sku: 'A1' }])
  await assert.rejects(patchProduct(cols, 'A1', { listPrice: -1 }), { statusCode: 400 })
  await assert.rejects(patchProduct(cols, 'A1', { stock: 1.5 }), { statusCode: 400 })
  assert.equal(await patchProduct(cols, 'ZZ', { stock: 1 }), null)
})

test('partners resolve by id, Commerce company, email domain, customer group, then the default', async () => {
  await importPartners(cols, [{ id: 'P1', name: 'Acme', commerceCompanyId: '7', customerGroupId: '3', emailDomain: 'Acme.example' }])
  await ensureDefaultPartner(cols, 'Demo')
  assert.equal((await resolvePartner(cols, { partnerId: 'P1' })).id, 'P1')
  assert.equal((await resolvePartner(cols, { commerceCompanyId: 7 })).id, 'P1')
  assert.equal((await resolvePartner(cols, { email: 'buyer@acme.example', customerGroupId: '9' })).id, 'P1')
  assert.equal((await resolvePartner(cols, { customerGroupId: '3' })).id, 'P1')
  const fallback = await resolvePartner(cols, { commerceCompanyId: '99' })
  assert.equal(fallback.id, DEFAULT_PARTNER_ID)
  assert.equal(fallback.isDefault, true)
})

test('credit limit and block changes raise company events carrying the Commerce company id', async () => {
  await importPartners(cols, [{ id: 'P1', commerceCompanyId: '7' }])
  await patchPartner(cols, 'P1', { creditLimit: 1000, blocked: true })
  const entries = await pending(cols)
  assert.deepEqual(entries.map((e) => e.event), ['be-observer.company_credit_update', 'be-observer.company_status_update'])
  assert.deepEqual(entries[0].value, { partnerId: 'P1', companyId: '7', creditLimit: 1000 })
  assert.deepEqual(entries[1].value, { partnerId: 'P1', companyId: '7', blocked: true })
})

test('conditions validate their shape and can be removed', async () => {
  await assert.rejects(upsertCondition(cols, { kind: 'nope' }), { statusCode: 400 })
  await assert.rejects(upsertCondition(cols, { kind: 'contractPrice', partnerId: 'P1' }), { statusCode: 400 })
  const c = await upsertCondition(cols, { kind: 'contractDiscount', partnerId: 'P1', percent: 10 })
  assert.equal((await listConditions(cols)).length, 1)
  assert.equal(await deleteCondition(cols, c._id), 1)
  assert.equal((await listConditions(cols)).length, 0)
})

test('wipe clears records, keeps settings and counters, stamps the time', async () => {
  await importProducts(cols, [{ sku: 'A1' }])
  await importPartners(cols, [{ id: 'P1' }])
  await updateSettings(cols, { displayName: 'Contoso ERP' })
  await cols.counters.replaceOne({ _id: 'salesOrder' }, { _id: 'salesOrder', value: 1234 }, { upsert: true })
  const removed = await wipe(cols)
  assert.equal(removed.products, 1)
  assert.equal(removed.businessPartners, 1)
  assert.equal((await cols.counters.findOne({ _id: 'salesOrder' })).value, 1234)
  const settings = await getSettings(cols)
  assert.equal(settings.displayName, 'Contoso ERP')
  assert.ok(settings.lastWipeAt)
})

test('the display name defaults from the deploy input, then from Acme', async () => {
  assert.equal((await getSettings(cols, 'Northwind ERP')).displayName, 'Northwind ERP')
  assert.equal((await getSettings(memoryCollections())).displayName, 'Acme ERP')
})

test('a redeploy with a new name renames the ERP unless it was renamed on screen', async () => {
  await getSettings(cols, 'First ERP')
  assert.equal((await getSettings(cols, 'Second ERP')).displayName, 'Second ERP')
  await updateSettings(cols, { displayName: 'Mine' })
  assert.equal((await getSettings(cols, 'Third ERP')).displayName, 'Mine')
})
