/*
 * The stored record shapes, pinned (business-structure plan, step 01). The owner asked on
 * 2026-09-24 whether the data model was understood and could not drift: the contract test
 * pins event payloads and routes, and nothing pinned what the ERP STORES. This does. One
 * of each record is made through the real modules, the raw document is read back from its
 * collection, and its keys must equal the checked-in fixture — a key that appears or
 * vanishes fails here first, and the fixture moves in the same commit as the field.
 *
 * The fixture was written from the shapes as read on 2026-09-24 (not typed from memory):
 * run this file with UPDATE_RECORD_SHAPES=1 to rewrite it, then review the diff.
 */
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { memoryCollections } = require('./helpers/memory-db')
const { importPartners, ensureDefaultPartner, DEFAULT_PARTNER_ID } = require('../lib/partners')
const { importProducts } = require('../lib/products')
const { createOrder } = require('../lib/orders')
const { confirmOrder, createShipment, postShipment, createInvoice } = require('../lib/fulfilment')
const { upsertCondition } = require('../lib/conditions')
const { getSettings, updateSettings, SETTINGS_ID } = require('../lib/settings')

const FIXTURE = path.join(__dirname, 'fixtures', 'record-shapes.json')
const UPDATE = process.env.UPDATE_RECORD_SHAPES === '1'
const keys = (o) => Object.keys(o).sort()

let cols
beforeEach(() => { cols = memoryCollections() })

/** One of each record, made the way the ERP makes them. */
async function makeRecords () {
  await importProducts(cols, [{ sku: 'A1', name: 'Trouser', listPrice: 10, warehouses: [{ code: 'default', name: 'Default Source', quantity: 50 }] }])
  await importPartners(cols, [{ id: 'C1', name: 'Acme', commerceCompanyId: '7', creditLimit: 1000, customerGroupId: '2', emailDomain: 'acme.example', blocked: false }])
  await ensureDefaultPartner(cols, 'Demo')
  const order = await createOrder(cols, { commerceOrderId: '42', commerceIncrementId: '000000042', partnerId: 'C1', lines: [{ sku: 'A1', qty: 3, price: 10, commerceItemId: 1 }] })
  await confirmOrder(cols, order.number)
  const withShipment = await createShipment(cols, order.number, { lines: [{ item: 10, qty: 3 }], warehouse: 'default' })
  await postShipment(cols, order.number, withShipment.shipments[0].number)
  await createInvoice(cols, order.number)
  await upsertCondition(cols, { kind: 'contractPrice', partnerId: 'C1', sku: 'A1', price: 9, validFrom: '2026-01-01', validTo: '2026-12-31', minQty: 2 })
  await upsertCondition(cols, { kind: 'contractDiscount', partnerId: 'C1', percent: 5 })
  await upsertCondition(cols, { kind: 'maxDiscount', percent: 20 })
  await getSettings(cols, 'Demo ERP')
  await updateSettings(cols, { displayName: 'Demo ERP', appearance: { palette: 'plum' } }, 'Demo ERP')

  const partner = await cols.businessPartners.findOne({ _id: 'C1' })
  const walkIn = await cols.businessPartners.findOne({ _id: DEFAULT_PARTNER_ID })
  const stored = await cols.salesOrders.findOne({ _id: order.number })
  const product = await cols.products.findOne({ _id: 'A1' })
  const conditions = await cols.pricingConditions.find({}).toArray()
  const settings = await cols.settings.findOne({ _id: SETTINGS_ID })
  const kind = (k) => conditions.find((c) => c.kind === k)
  return {
    partner: keys(partner),
    walkInPartner: keys(walkIn),
    product: keys(product),
    warehouse: keys(product.warehouses[0]),
    order: keys(stored),
    orderLine: keys(stored.lines[0]),
    shipment: keys(stored.shipments[0]),
    shipmentLine: keys(stored.shipments[0].lines[0]),
    invoice: keys(stored.invoice),
    invoiceLine: keys(stored.invoice.lines[0]),
    historyEntry: keys(stored.history[0]),
    contractPrice: keys(kind('contractPrice')),
    contractDiscount: keys(kind('contractDiscount')),
    maxDiscount: keys(kind('maxDiscount')),
    settings: keys(settings),
    appearance: keys(settings.appearance)
  }
}

test('every stored record has exactly the keys the fixture pins', async () => {
  const shapes = await makeRecords()
  if (UPDATE) {
    fs.writeFileSync(FIXTURE, `${JSON.stringify(shapes, null, 2)}\n`)
  }
  const pinned = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
  assert.deepEqual(Object.keys(shapes).sort(), Object.keys(pinned).sort(), 'the set of records pinned')
  for (const record of Object.keys(pinned)) {
    assert.deepEqual(shapes[record], pinned[record], `${record}: a stored key appeared or vanished; if that was intended, run with UPDATE_RECORD_SHAPES=1 and review the fixture diff`)
  }
})

test('the pin is a pin: a key the fixture does not name fails', async () => {
  const shapes = await makeRecords()
  const pinned = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
  assert.throws(() => assert.deepEqual([...shapes.partner, 'salesOrgs'], pinned.partner))
})
