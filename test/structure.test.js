/*
 * The business structure in the ERP's records (plan erp-business-structure, step 03): a
 * customer's sales organisations and legal identity, an order's sales organisation, a
 * condition scoped to one, warehouse names of the ERP's own, and the structure derived
 * on read for the Organisation card.
 */
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { memoryCollections, invoke } = require('./helpers/memory-db')
const { importPartners, ensureDefaultPartner, getPartner, describePartner, upgradePartner } = require('../lib/partners')
const { importProducts } = require('../lib/products')
const { createOrder, getOrder, describeOrder } = require('../lib/orders')
const { upsertCondition } = require('../lib/conditions')
const { quote } = require('../lib/pricing')
const { getSettings, updateSettings } = require('../lib/settings')
const { describeStructure } = require('../lib/structure')
const admin = require('../actions/admin')
const health = require('../actions/health')

let cols
beforeEach(async () => {
  cols = memoryCollections()
  await importProducts(cols, [{ sku: 'A1', name: 'Trouser', listPrice: 100, warehouses: [{ code: 'default', name: 'Default Source', quantity: 5 }, { code: 'east', name: 'East DC', quantity: 2 }] }])
})

const STRUCTURE = { websites: [
  { code: 'base', name: 'Main Website', salesOrg: '1000', salesOrgName: null, storeInfo: { currency: 'USD', countryId: 'US', vatNumber: null, address: null } },
  { code: 'eu', name: 'Europe', salesOrg: '2000', salesOrgName: 'Online EU', storeInfo: { currency: 'EUR', countryId: 'DE', vatNumber: null, address: null } }
] }

test('a company arrives with its sales organisations, legal identity and website; a re-import replaces the list and keeps a legal field the row omits', async () => {
  await importPartners(cols, [{ id: 'C7', name: 'Acme', commerceCompanyId: '7', salesOrgs: ['2000'], legalName: 'Acme Trading LLC', vatTaxId: 'US12', resellerId: 'R-1', legalAddress: { street: ['1 Main St', ''], city: 'Austin', region: 'TX', postcode: '78701', countryId: 'US', telephone: null }, website: { id: 2, code: 'eu' } }])
  const partner = await getPartner(cols, 'C7')
  assert.deepEqual(partner.salesOrgs, ['2000'])
  assert.equal(partner.legalName, 'Acme Trading LLC')
  assert.deepEqual(partner.legalAddress, { street: ['1 Main St'], city: 'Austin', region: 'TX', postcode: '78701', countryId: 'US', telephone: null })
  assert.deepEqual(partner.website, { id: 2, code: 'eu' })
  assert.equal(partner.salesOrg, undefined, 'the singular field is gone')
  await importPartners(cols, [{ id: 'C7', name: 'Acme', salesOrgs: ['1000', '2000'] }])
  const again = await getPartner(cols, 'C7')
  assert.deepEqual(again.salesOrgs, ['1000', '2000'])
  assert.equal(again.legalName, 'Acme Trading LLC', 'omitted by the row: kept')
  const walkIn = await ensureDefaultPartner(cols, 'Demo')
  assert.deepEqual(walkIn.salesOrgs, ['*'])
})

test('a partner stored with the old single field reads as its sales organisations, and the default alone as none', () => {
  assert.deepEqual(upgradePartner({ _id: 'C1', id: 'C1', salesOrg: '2000', blocking: 'open' }).salesOrgs, ['2000'])
  assert.deepEqual(upgradePartner({ _id: 'C2', id: 'C2', salesOrg: '1000', blocking: 'open' }).salesOrgs, [])
  assert.deepEqual(upgradePartner({ _id: 'P000000', id: 'P000000', salesOrg: '1000', isDefault: true, blocking: 'open' }).salesOrgs, ['*'])
  assert.equal(upgradePartner({ _id: 'C1', id: 'C1', salesOrg: '2000', blocking: 'open' }).legalName, null)
})

test('an order carries the sales organisation the request names (1000 when none), the document prints it, and the customer is widened to it', async () => {
  await importPartners(cols, [{ id: 'C7', name: 'Acme', commerceCompanyId: '7', salesOrgs: ['1000'] }])
  const eu = await createOrder(cols, { commerceOrderId: '1', partnerId: 'C7', salesOrg: '2000', salesOrgName: 'Online EU', lines: [{ sku: 'A1', qty: 1, price: 100 }] })
  assert.equal(eu.salesOrg, '2000')
  assert.equal(eu.salesOrgName, 'Online EU')
  const plain = await createOrder(cols, { commerceOrderId: '2', partnerId: 'C7', lines: [{ sku: 'A1', qty: 1, price: 100 }] })
  assert.equal(plain.salesOrg, '1000')
  assert.equal(plain.salesOrgName, null)
  assert.deepEqual((await getPartner(cols, 'C7')).salesOrgs, ['1000', '2000'], 'the customer has now bought through 2000')
  const doc = await describeOrder(cols, await getOrder(cols, eu.number))
  assert.equal(doc.salesOrg, '2000')
  assert.equal(doc.partner.salesOrg, undefined)
  // A stored order from before the structure existed sold through 1000.
  await cols.salesOrders.replaceOne({ _id: 'OLD' }, { _id: 'OLD', number: 'OLD', commerceOrderId: '9', lines: [], header: 'created', shipments: [], invoice: null, history: [], createdAt: '2026-01-01T00:00:00Z' }, { upsert: true })
  assert.equal((await getOrder(cols, 'OLD')).salesOrg, '1000')
})

test('a condition scoped to one sales organisation applies only there, beats an unscoped one, and says why it did not apply elsewhere', async () => {
  await importPartners(cols, [{ id: 'C7', name: 'Acme', commerceCompanyId: '7' }])
  const partner = await getPartner(cols, 'C7')
  const products = [{ sku: 'A1', listPrice: 100 }]
  const conditions = [
    await upsertCondition(cols, { kind: 'contractDiscount', partnerId: 'C7', percent: 10 }),
    await upsertCondition(cols, { kind: 'contractDiscount', partnerId: 'C7', percent: 25, salesOrg: '2000' })
  ]
  const eu = quote({ products, partner, conditions, lines: [{ sku: 'A1', qty: 1 }], salesOrg: '2000' })
  assert.equal(eu.lines[0].contractPrice, 75)
  assert.equal(eu.salesOrg, '2000')
  const us = quote({ products, partner, conditions, lines: [{ sku: 'A1', qty: 1 }], salesOrg: '1000' })
  assert.equal(us.lines[0].contractPrice, 90)
  assert.deepEqual(us.lines[0].notApplied.map((n) => n.reason), ['for sales organisation 2000; this is 1000'])
  const anywhere = quote({ products, partner, conditions, lines: [{ sku: 'A1', qty: 1 }] })
  assert.equal(anywhere.lines[0].contractPrice, 75, 'a quote naming no sales organisation is not held back by a scope')
})

test('warehouses take the Commerce source name once, keep a name given on screen, and refuse an empty rename', async () => {
  const settings = await getSettings(cols)
  assert.deepEqual(settings.warehouses, { default: { name: 'Default Source' }, east: { name: 'East DC' } })
  await updateSettings(cols, { warehouses: { east: { name: 'Plant 1100 · Newark DC' } } })
  await importProducts(cols, [{ sku: 'B2', name: 'Shirt', warehouses: [{ code: 'east', name: 'East DC (renamed in Commerce)', quantity: 1 }, { code: 'west', name: 'West DC', quantity: 1 }] }])
  const after = await getSettings(cols)
  assert.equal(after.warehouses.east.name, 'Plant 1100 · Newark DC')
  assert.equal(after.warehouses.west.name, 'West DC')
  await assert.rejects(updateSettings(cols, { warehouses: { east: { name: ' ' } } }), { statusCode: 400 })
})

test('the structure is derived on read: company code, sales organisations with counts, warehouses under ERP names, and the websites left on the default', async () => {
  await invoke(admin, cols, { method: 'POST', path: '/import', body: { partners: [{ id: 'C7', name: 'Acme', commerceCompanyId: '7', salesOrgs: ['2000'] }, { id: 'C8', name: 'Bare', commerceCompanyId: '8', salesOrgs: [] }], structure: STRUCTURE, projectName: 'Demo' } })
  await createOrder(cols, { commerceOrderId: '1', partnerId: 'C7', salesOrg: '2000', lines: [{ sku: 'A1', qty: 1, price: 100 }] })
  await createOrder(cols, { commerceOrderId: '2', partnerId: 'C8', lines: [{ sku: 'A1', qty: 1, price: 100 }] })
  await updateSettings(cols, { displayName: 'Northwind ERP', warehouses: { east: { name: 'Plant 1100' } } })
  const structure = await describeStructure(cols)
  assert.deepEqual(structure.companyCode, { code: '1000', name: 'Northwind ERP', currency: 'USD', countryId: 'US', vatNumber: null, address: null })
  assert.deepEqual(structure.salesOrgs, [
    { code: '1000', name: 'Main Website', websiteCode: 'base', customers: 1, orders: 1 },
    { code: '2000', name: 'Online EU', websiteCode: 'eu', customers: 1, orders: 1 }
  ])
  assert.deepEqual(structure.warehouses, [
    { code: 'default', name: 'Default Source', commerceName: 'Default Source', products: 1 },
    { code: 'east', name: 'Plant 1100', commerceName: 'East DC', products: 1 }
  ])
  assert.deepEqual(structure.unmapped, ['base'], 'base fell back to 1000 while eu named one')
  const res = await invoke(health, cols)
  assert.equal(res.body.structure.companyCode.code, '1000')
  const doc = await describePartner(cols, await getPartner(cols, 'C7'))
  assert.deepEqual(doc.salesOrgNames, { 1000: 'Main Website', 2000: 'Online EU' })
})

test('a warehouse renamed in Settings prints its ERP name on the shipment and in the order\'s ship-from choices, with the Commerce name beside; the invoice carries the seller', async () => {
  const { confirmOrder, createShipment, postShipment, createInvoice, getShipment, getInvoice } = require('../lib/fulfilment')
  await invoke(admin, cols, { method: 'POST', path: '/import', body: { partners: [{ id: 'C7', name: 'Acme', commerceCompanyId: '7', salesOrgs: ['2000'] }], structure: STRUCTURE, projectName: 'Demo' } })
  await updateSettings(cols, { displayName: 'Northwind ERP', warehouses: { east: { name: 'Plant 1100 · Newark DC' } } })
  const order = await confirmOrder(cols, (await createOrder(cols, { commerceOrderId: '1', partnerId: 'C7', salesOrg: '2000', salesOrgName: 'Online EU', lines: [{ sku: 'A1', qty: 2, price: 100, commerceItemId: 1 }] })).number)
  const doc = await describeOrder(cols, order)
  assert.deepEqual(doc.warehouses.find((w) => w.code === 'east'), { code: 'east', name: 'Plant 1100 · Newark DC', commerceName: 'East DC' })
  const withShipment = await createShipment(cols, order.number, { lines: [{ item: 10, qty: 2 }], warehouse: 'east' })
  await postShipment(cols, order.number, withShipment.shipments[0].number)
  const shipment = await getShipment(cols, withShipment.shipments[0].number)
  assert.deepEqual(shipment.warehouse, { code: 'east', name: 'Plant 1100 · Newark DC', commerceName: 'East DC' })
  const invoiced = await createInvoice(cols, order.number)
  const invoice = await getInvoice(cols, invoiced.invoice.number)
  assert.deepEqual(invoice.seller, { companyCode: '1000', name: 'Northwind ERP', salesOrg: '2000', salesOrgName: 'Online EU', currency: 'EUR', countryId: 'DE', vatNumber: null, address: null })
})
