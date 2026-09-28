/*
 * The contracts routes (actions/contracts), end to end over the in-memory store:
 *   GET contracts[?partnerId=]  ·  GET contracts/in-force[?partnerId=]  ·  GET contracts/:number
 *   POST contracts  ·  PATCH contracts/:number  ·  POST contracts/:number/activate|deactivate
 */
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { memoryCollections, invoke } = require('./helpers/memory-db')
const admin = require('../actions/admin')
const contracts = require('../actions/contracts')

let cols
beforeEach(async () => {
  cols = memoryCollections()
  await invoke(admin, cols, {
    method: 'POST',
    path: '/import',
    body: { products: [{ sku: 'A1', name: 'Widget', listPrice: 100 }, { sku: 'B2', name: 'Gadget', listPrice: 50 }], partners: [{ id: 'P1', name: 'Acme' }, { id: 'P2', name: 'Kukla Studios' }] }
  })
})

const create = (body) => invoke(contracts, cols, { method: 'POST', body: { partnerId: 'P1', description: 'Terms', startingDate: '2026-01-01', lines: [{ sku: 'A1', kind: 'price', price: 80 }], ...body } })

test('create answers 201 with a draft; get, list and the customer filter find it', async () => {
  const res = await create()
  assert.equal(res.statusCode, 201)
  assert.equal(res.body.status, 'draft')
  await create({ partnerId: 'P2' })
  const one = await invoke(contracts, cols, { path: `/${res.body.number}` })
  assert.equal(one.body.number, res.body.number)
  assert.equal((await invoke(contracts, cols)).body.items.length, 2)
  const p2 = await invoke(contracts, cols, { params: { partnerId: 'P2' } })
  assert.deepEqual(p2.body.items.map((c) => c.partnerId), ['P2'])
  assert.equal((await invoke(contracts, cols, { path: '/4999999999' })).statusCode, 404)
  assert.equal((await create({ partnerId: 'NOPE' })).statusCode, 400)
})

test('activate, patch and deactivate, and prices in force follow', async () => {
  const { body: c } = await create()
  const inForce = () => invoke(contracts, cols, { path: '/in-force' })
  assert.deepEqual((await inForce()).body, { items: [] })
  assert.equal((await invoke(contracts, cols, { method: 'POST', path: `/${c.number}/activate` })).body.status, 'active')
  assert.deepEqual((await inForce()).body, { items: [{ partnerId: 'P1', lines: [{ sku: 'A1', kind: 'price', price: 80, minQty: 1, contractNumber: c.number }] }] })
  const patched = await invoke(contracts, cols, { method: 'PATCH', path: `/${c.number}`, body: { lines: [{ sku: 'B2', kind: 'discount', percent: 15, minQty: 3 }] } })
  assert.deepEqual(patched.body.lines, [{ sku: 'B2', kind: 'discount', percent: 15, minQty: 3 }])
  assert.equal((await invoke(contracts, cols, { method: 'POST', path: `/${c.number}/deactivate` })).body.status, 'inactive')
  assert.deepEqual((await inForce()).body, { items: [] })
  assert.equal((await invoke(contracts, cols, { method: 'POST', path: `/${c.number}/deactivate` })).statusCode, 400)
  assert.equal((await invoke(contracts, cols, { method: 'POST', path: '/4999999999/activate' })).statusCode, 404)
})

test('in force for one customer answers that customer, with an empty list when it has nothing', async () => {
  const { body: c } = await create()
  await invoke(contracts, cols, { method: 'POST', path: `/${c.number}/activate` })
  const p1 = await invoke(contracts, cols, { path: '/in-force', params: { partnerId: 'P1' } })
  assert.deepEqual(p1.body.items.map((i) => [i.partnerId, i.lines.length]), [['P1', 1]])
  const p2 = await invoke(contracts, cols, { path: '/in-force', params: { partnerId: 'P2' } })
  assert.deepEqual(p2.body, { items: [{ partnerId: 'P2', lines: [] }] })
})

test('POST pricing/quote prices from the customer\'s active contract', async () => {
  const pricing = require('../actions/pricing')
  const { body: c } = await create()
  const ask = () => invoke(pricing, cols, { method: 'POST', path: '/quote', body: { partnerId: 'P1', lines: [{ sku: 'A1', qty: 1 }] } })
  assert.equal((await ask()).body.lines[0].contractPrice, 100, 'a draft prices nothing')
  await invoke(contracts, cols, { method: 'POST', path: `/${c.number}/activate` })
  const line = (await ask()).body.lines[0]
  assert.equal(line.contractPrice, 80)
  assert.equal(line.contractNumber, c.number)
})
