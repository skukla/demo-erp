/*
 * The prices in force the ERP sends are what it would charge (lib/net-prices), so a change
 * to a loose pricing condition or to a list price moves them like a price list change does:
 * GET contracts/in-force answers the new set, and contract.changed is raised, with the whole
 * set, for every customer whose set moved and no one else.
 */
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { memoryCollections, invoke } = require('./helpers/memory-db')
const { importProducts, patchProduct } = require('../lib/products')
const { importPartners } = require('../lib/partners')
const { upsertCondition, deleteCondition } = require('../lib/conditions')
const { createContract, activateContract } = require('../lib/contracts')
const { pending } = require('../lib/events')

let cols
beforeEach(async () => {
  cols = memoryCollections()
  await importProducts(cols, [{ sku: 'A1', name: 'Widget', listPrice: 100 }, { sku: 'B2', name: 'Gadget', listPrice: 50 }])
  await importPartners(cols, [{ id: 'P1', name: 'Acme' }, { id: 'P2', name: 'Kukla Studios' }, { id: 'P3', name: 'Third' }])
})

const changes = async () => (await pending(cols)).filter((e) => e.type === 'PriceList.Changed').map((e) => ({ partnerId: e.data.Customer, lines: e.data.Lines }))
// Every published line carries salesOrg (contract version 12): null is "for every website".
const loose = (sku, extra) => ({ sku, minQty: 1, contractNumber: null, appliesTo: 'customer', salesOrg: null, ...extra })
const tenOff = [loose('A1', { kind: 'discount', percent: 10 }), loose('B2', { kind: 'discount', percent: 10 })]

test('GET contracts/in-force answers a customer whose only price is a loose all-products discount', async () => {
  await upsertCondition(cols, { kind: 'contractDiscount', partnerId: 'P2', percent: 10 })
  const all = await invoke(require('../actions/contracts'), cols, { path: '/in-force' })
  assert.deepEqual(all.body, { items: [{ partnerId: 'P2', lines: tenOff }] })
  const one = await invoke(require('../actions/contracts'), cols, { path: '/in-force', params: { partnerId: 'P2' } })
  assert.deepEqual(one.body, { items: [{ partnerId: 'P2', lines: tenOff }] })
})

test('creating, changing and deleting a customer\'s loose condition each raise that customer\'s whole set', async () => {
  const made = await upsertCondition(cols, { kind: 'contractDiscount', partnerId: 'P1', percent: 10 })
  await upsertCondition(cols, { ...made, percent: 12 })
  await upsertCondition(cols, { ...made, percent: 12, validFrom: null })
  await deleteCondition(cols, made._id)
  assert.deepEqual(await changes(), [
    { partnerId: 'P1', lines: tenOff },
    { partnerId: 'P1', lines: tenOff.map((l) => ({ ...l, percent: 12 })) },
    { partnerId: 'P1', lines: [] }
  ], 'the edit that moved no price raised nothing')
})

test('moving a condition to another customer raises for both', async () => {
  const made = await upsertCondition(cols, { kind: 'contractPrice', partnerId: 'P1', sku: 'A1', price: 90 })
  await upsertCondition(cols, { ...made, partnerId: 'P2' })
  assert.deepEqual(await changes(), [
    { partnerId: 'P1', lines: [loose('A1', { kind: 'price', price: 90 })] },
    { partnerId: 'P1', lines: [] },
    { partnerId: 'P2', lines: [loose('A1', { kind: 'price', price: 90 })] }
  ])
})

test('a store-wide ceiling raises for each customer whose prices it cut, and for no one else', async () => {
  await upsertCondition(cols, { kind: 'contractDiscount', partnerId: 'P1', percent: 20 })
  const c = await createContract(cols, { partnerId: 'P2', startingDate: '2026-01-01', lines: [{ sku: 'A1', kind: 'discount', percent: 5 }] })
  await activateContract(cols, c.number)
  const before = (await changes()).length
  await upsertCondition(cols, { kind: 'maxDiscount', percent: 15 })
  assert.deepEqual((await changes()).slice(before), [
    { partnerId: 'P1', lines: tenOff.map((l) => ({ ...l, percent: 15 })) }
  ], 'P2\'s 5% is under the ceiling and P3 has no price: neither moved')
})

test('a list price change raises for a customer whose fixed price it moves across the ceiling\'s floor', async () => {
  await upsertCondition(cols, { kind: 'maxDiscount', percent: 15 })
  await upsertCondition(cols, { kind: 'contractPrice', partnerId: 'P1', sku: 'A1', price: 90 })
  await upsertCondition(cols, { kind: 'contractDiscount', partnerId: 'P2', sku: 'A1', percent: 10 })
  const before = (await changes()).length
  // 110 × 0.85 = 93.50: the fixed 90 is now below the floor and is cut to it.
  await patchProduct(cols, 'A1', { listPrice: 110 })
  // 105 × 0.85 = 89.25: 90 stands again.
  await patchProduct(cols, 'A1', { listPrice: 105 })
  await patchProduct(cols, 'A1', { name: 'Widget II' })
  assert.deepEqual((await changes()).slice(before), [
    { partnerId: 'P1', lines: [loose('A1', { kind: 'discount', percent: 15 })] },
    { partnerId: 'P1', lines: [loose('A1', { kind: 'price', price: 90 })] }
  ], 'P2\'s discount follows the list price by itself, and a new name moves no price')
})
