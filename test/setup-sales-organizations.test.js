/*
 * Settings → Sales organizations (AB-59; AB-26y step 2: the ERP owns its structure). The
 * ERP keeps its own table: code, name, currency, the website it serves. The first fill seeds
 * it once, while the ERP has none; after that a fill leaves it alone, and Settings adds and
 * edits rows. The names and currencies are what the customer document, the invoice's seller
 * block and the structure health answers print.
 */
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { memoryCollections, invoke } = require('./helpers/memory-db')
const { importProducts } = require('../lib/products')
const { getPartner, describePartner } = require('../lib/partners')
const { createOrder } = require('../lib/orders')
const { confirmOrder, createShipment, postShipment, createInvoice, getInvoice } = require('../lib/fulfilment')
const settings = require('../actions/settings')
const health = require('../actions/health')
const admin = require('../actions/admin')

const site = (code, name, salesOrg, salesOrgName, currency) => ({ code, name, salesOrg, salesOrgName, storeInfo: { currency, countryId: null, vatNumber: null, address: null } })
const FIRST = { websites: [site('base', 'Main Website', '1000', 'Online US', 'USD'), site('eu', 'Europe', '2000', 'Online EU', 'EUR')] }

let cols
beforeEach(async () => {
  cols = memoryCollections()
  await importProducts(cols, [{ sku: 'A1', name: 'Trouser', listPrice: 100, warehouses: [{ code: 'default', name: 'Default Source', quantity: 5 }] }])
})

const fill = (structure) => invoke(admin, cols, { method: 'POST', path: '/import', body: { structure, partners: [{ id: 'C7', name: 'Acme', salesOrgs: ['2000'] }] } })
const setup = async () => (await invoke(settings, cols, { path: '/setup' })).body
const add = (body) => invoke(settings, cols, { method: 'POST', path: '/sales-organizations', body })
const edit = (code, body) => invoke(settings, cols, { method: 'PATCH', path: `/sales-organizations/${code}`, body })

test('the first fill seeds the table; a later fill does not overwrite it', async () => {
  await fill(FIRST)
  assert.deepEqual((await setup()).salesOrganizations, [
    { code: '1000', name: 'Online US', currency: 'USD', websiteCode: 'base' },
    { code: '2000', name: 'Online EU', currency: 'EUR', websiteCode: 'eu' }
  ])
  await fill({ websites: [site('base', 'Main Website', '1000', 'Renamed in Commerce', 'USD')] })
  assert.deepEqual((await setup()).salesOrganizations.map((o) => o.name), ['Online US', 'Online EU'])
})

test('add a sales organization; it answers 201 with the table, and the structure carries it', async () => {
  await fill(FIRST)
  const res = await add({ code: '3000', name: 'Online UK', currency: 'gbp', websiteCode: 'UK' })
  assert.equal(res.statusCode, 201)
  assert.deepEqual(res.body.salesOrganizations.at(-1), { code: '3000', name: 'Online UK', currency: 'GBP', websiteCode: 'uk' })
  const structure = (await invoke(health, cols)).body.structure
  assert.deepEqual(structure.salesOrgs.find((o) => o.code === '3000'), { code: '3000', name: 'Online UK', currency: 'GBP', websiteCode: 'uk', customers: 0, orders: 0 })
})

test('an edited name and currency are what the customer document and the invoice print', async () => {
  await fill(FIRST)
  await edit('2000', { name: 'Europe B2B', currency: 'CHF' })
  const doc = await describePartner(cols, await getPartner(cols, 'C7'))
  assert.equal(doc.salesOrgNames['2000'], 'Europe B2B')
  const order = await createOrder(cols, { purchaseOrderByCustomer: '1', partnerId: 'C7', salesOrg: '2000', salesOrgName: 'Online EU', lines: [{ sku: 'A1', qty: 1, price: 100, customerLineReference: '1' }] })
  await confirmOrder(cols, order.number)
  const shipped = await createShipment(cols, order.number, { lines: [{ item: 10, qty: 1 }] })
  await postShipment(cols, order.number, shipped.shipments[0].number)
  const invoice = await getInvoice(cols, (await createInvoice(cols, order.number)).invoice.number)
  assert.equal(invoice.seller.salesOrgName, 'Europe B2B')
  assert.equal(invoice.seller.currency, 'CHF')
})

test('before any fill, an added row is the table; an ERP filled before the table existed keeps its websites\' rows when one is added', async () => {
  await add({ code: '1000', name: 'Home', currency: 'USD' })
  assert.deepEqual((await setup()).salesOrganizations, [{ code: '1000', name: 'Home', currency: 'USD', websiteCode: null }])
  // An ERP filled before: the mirror is there, the table is not.
  const fresh = memoryCollections()
  cols = fresh
  await invoke(admin, cols, { method: 'POST', path: '/import', body: { partners: [{ id: 'C7', name: 'Acme' }] } })
  const stored = await cols.settings.findOne({ _id: 'erp' })
  await cols.settings.replaceOne({ _id: 'erp' }, { ...stored, structureMirror: FIRST, salesOrganizations: [] }, { upsert: true })
  assert.equal((await setup()).salesOrganizations.length, 2, 'read from the websites the last fill sent')
  await add({ code: '3000', name: 'Online UK', currency: 'GBP' })
  assert.deepEqual((await setup()).salesOrganizations.map((o) => o.code), ['1000', '2000', '3000'])
})

test('refusals, in words', async () => {
  await fill(FIRST)
  const cases = [
    [add({ code: '2000', name: 'Again', currency: 'EUR' }), 400, 'Sales organization 2000 exists already.'],
    [add({ code: '30000', name: 'Long', currency: 'EUR' }), 400, 'A sales organization code is 1 to 4 letters or digits, such as 2000.'],
    [add({ code: '3000', currency: 'EUR' }), 400, 'A sales organization needs a name.'],
    [add({ code: '3000', name: 'No money' }), 400, 'A currency is a three-letter code, such as USD.'],
    [add({ code: '3000', name: 'Twice', currency: 'EUR', websiteCode: 'eu' }), 400, 'Website eu is served by sales organization 2000.'],
    [edit('2000', { name: '' }), 400, 'A sales organization needs a name.'],
    [edit('2000', { code: '2100' }), 400, 'A sales organization keeps its code: orders and customers carry 2000.'],
    [edit('9000', { name: 'Nobody' }), 404, 'Sales organization 9000 was not found.']
  ]
  for (const [call, status, message] of cases) {
    const res = await call
    assert.equal(res.statusCode, status, message)
    assert.equal(res.body.errorMessage, message)
  }
  assert.equal((await setup()).salesOrganizations.length, 2)
})
