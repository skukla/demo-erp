/*
 * Contracts: one customer's agreement, with a number, a term, a status and its price lines
 * (lib/contracts). Business Central's sales price list, in this ERP's storage.
 */
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { memoryCollections } = require('./helpers/memory-db')
const { importProducts } = require('../lib/products')
const { importPartners } = require('../lib/partners')
const { createContract, getContract, listContracts, updateContract, activateContract, deactivateContract } = require('../lib/contracts')
const { wipe } = require('../lib/admin')

let cols
beforeEach(async () => {
  cols = memoryCollections()
  await importProducts(cols, [{ sku: 'A1', name: 'Widget', listPrice: 100 }, { sku: 'B2', name: 'Gadget', listPrice: 50 }])
  await importPartners(cols, [{ id: 'P1', name: 'Acme' }, { id: 'P2', name: 'Kukla Studios' }])
})

const draft = (extra) => ({
  partnerId: 'P1',
  description: 'Acme 2026 terms',
  startingDate: '2026-01-01',
  lines: [{ sku: 'A1', kind: 'price', price: 80 }],
  ...extra
})

test('a new contract is a draft with the ERP\'s own number, and its lines default to quantity 1', async () => {
  const c = await createContract(cols, draft({ lines: [{ sku: 'A1', kind: 'price', price: 80 }, { sku: 'B2', kind: 'discount', percent: 10, minQty: 5 }] }))
  assert.equal(c.number, '4000000001')
  assert.equal(c.status, 'draft')
  assert.equal(c.partnerId, 'P1')
  assert.equal(c.endingDate, null)
  assert.deepEqual(c.lines, [
    { sku: 'A1', kind: 'price', price: 80, minQty: 1 },
    { sku: 'B2', kind: 'discount', percent: 10, minQty: 5 }
  ])
  const second = await createContract(cols, draft())
  assert.equal(second.number, '4000000002')
  assert.deepEqual(await getContract(cols, '4000000001'), c)
})

test('a contract is refused when it names no known customer, a bad date, or a bad line', async () => {
  const refused = async (input, message) => assert.rejects(createContract(cols, input), (e) => e.statusCode === 400 && message.test(e.message))
  await refused(draft({ partnerId: 'NOPE' }), /customer NOPE/i)
  await refused(draft({ startingDate: '28/09/2026' }), /startingDate/)
  await refused(draft({ startingDate: undefined }), /startingDate/)
  await refused(draft({ endingDate: '2025-12-31' }), /endingDate/)
  await refused(draft({ lines: [{ sku: 'ZZ', kind: 'price', price: 1 }] }), /ZZ/)
  await refused(draft({ lines: [{ sku: 'A1', kind: 'rebate', price: 1 }] }), /kind/)
  await refused(draft({ lines: [{ sku: 'A1', kind: 'price', price: -1 }] }), /price/)
  await refused(draft({ lines: [{ sku: 'A1', kind: 'discount', percent: 120 }] }), /percent/)
  await refused(draft({ lines: [{ sku: 'A1', kind: 'price', price: 1, minQty: 0 }] }), /minQty/)
  await refused(draft({ lines: [{ sku: 'A1', kind: 'price', price: 1 }, { sku: 'A1', kind: 'discount', percent: 5 }] }), /once/)
})

test('the list filters by customer', async () => {
  await createContract(cols, draft())
  await createContract(cols, draft({ partnerId: 'P2' }))
  assert.equal((await listContracts(cols)).length, 2)
  assert.deepEqual((await listContracts(cols, { partnerId: 'P2' })).map((c) => c.partnerId), ['P2'])
})

test('draft → active → inactive → active; a draft cannot be deactivated', async () => {
  const c = await createContract(cols, draft())
  await assert.rejects(deactivateContract(cols, c.number), (e) => e.statusCode === 400)
  assert.equal((await activateContract(cols, c.number)).status, 'active')
  await assert.rejects(activateContract(cols, c.number), (e) => e.statusCode === 400)
  assert.equal((await deactivateContract(cols, c.number)).status, 'inactive')
  assert.equal((await activateContract(cols, c.number)).status, 'active')
  assert.equal(await activateContract(cols, '4999999999'), null)
})

test('lines, dates and description change while draft or active, never once inactive', async () => {
  const c = await createContract(cols, draft())
  const edited = await updateContract(cols, c.number, { description: 'Renewed', endingDate: '2026-12-31', lines: [{ sku: 'B2', kind: 'discount', percent: 20 }] })
  assert.equal(edited.description, 'Renewed')
  assert.equal(edited.endingDate, '2026-12-31')
  assert.deepEqual(edited.lines, [{ sku: 'B2', kind: 'discount', percent: 20, minQty: 1 }])
  assert.equal(edited.partnerId, 'P1', 'the customer is not changed by an update')
  await activateContract(cols, c.number)
  assert.equal((await updateContract(cols, c.number, { endingDate: null })).endingDate, null)
  await deactivateContract(cols, c.number)
  await assert.rejects(updateContract(cols, c.number, { description: 'x' }), (e) => e.statusCode === 400 && /inactive/.test(e.message))
  await assert.rejects(updateContract(cols, c.number, { lines: [{ sku: 'ZZ', kind: 'price', price: 1 }] }), (e) => e.statusCode === 400)
})

test('a wipe removes contracts; the numbering carries on', async () => {
  await createContract(cols, draft())
  const removed = await wipe(cols)
  assert.equal(removed.contracts, 1)
  assert.deepEqual(await listContracts(cols), [])
  await importProducts(cols, [{ sku: 'A1', name: 'Widget', listPrice: 100 }])
  await importPartners(cols, [{ id: 'P1', name: 'Acme' }])
  assert.equal((await createContract(cols, draft())).number, '4000000002')
})
