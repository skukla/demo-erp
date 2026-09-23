/* What the Settings screen says after a wipe, from the counts the action answers. */
const { test } = require('node:test')
const assert = require('node:assert/strict')

async function load () {
  return import('../screen/src/wipeSummary.js')
}

test('names every collection that had something in it, in the words the screen uses', async () => {
  const { wipeSummary } = await load()
  assert.equal(
    wipeSummary({ products: 182, businessPartners: 4, pricingConditions: 0, salesOrders: 2, events: 8 }),
    'Wiped 182 products, 4 customers, 2 sales orders and 8 events. The order numbering and the settings stay.'
  )
})

test('counts of one read as one', async () => {
  const { wipeSummary } = await load()
  assert.equal(
    wipeSummary({ products: 1, businessPartners: 1, pricingConditions: 1, salesOrders: 1, events: 1 }),
    'Wiped 1 product, 1 customer, 1 pricing condition, 1 sales order and 1 event. The order numbering and the settings stay.'
  )
})

test('a single collection needs no list', async () => {
  const { wipeSummary } = await load()
  assert.equal(wipeSummary({ events: 3 }), 'Wiped 3 events. The order numbering and the settings stay.')
})

test('an ERP that was already empty says so', async () => {
  const { wipeSummary } = await load()
  assert.equal(wipeSummary({ products: 0, events: 0 }), 'Nothing to wipe: the ERP was already empty.')
  assert.equal(wipeSummary({}), 'Nothing to wipe: the ERP was already empty.')
  assert.equal(wipeSummary(undefined), 'Nothing to wipe: the ERP was already empty.')
})

test('a collection the screen has no words for still shows its count', async () => {
  const { wipeSummary } = await load()
  assert.equal(wipeSummary({ widgets: 2 }), 'Wiped 2 widgets. The order numbering and the settings stay.')
})
