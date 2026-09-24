/*
 * Which area the address bar is asking for, and what it asks of it.
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')

async function load () {
  return import('../screen/src/pageRoute.js')
}

const KEYS = ['home', 'products', 'partners', 'orders', 'pricing', 'events', 'settings']

test('an area in the hash is the area asked for', async () => {
  const { pageFromHash } = await load()
  assert.equal(pageFromHash('#pricing', KEYS), 'pricing')
  assert.equal(pageFromHash('#home', KEYS), 'home')
})

test('the leading hash is optional, because location.hash omits it when empty', async () => {
  const { pageFromHash } = await load()
  assert.equal(pageFromHash('orders', KEYS), 'orders')
})

test('no hash asks for nothing, and the caller decides where that lands', async () => {
  const { pageFromHash } = await load()
  assert.equal(pageFromHash('', KEYS), null)
  assert.equal(pageFromHash('#', KEYS), null)
  assert.equal(pageFromHash(null, KEYS), null)
  assert.equal(pageFromHash(undefined, KEYS), null)
})

test('an area that does not exist asks for nothing, rather than a blank screen', async () => {
  const { pageFromHash } = await load()
  assert.equal(pageFromHash('#nope', KEYS), null)
  assert.equal(pageFromHash('#Pricing', KEYS), null)
  assert.equal(pageFromHash('#pricing/extra', KEYS), null)
})

test('a query after the area is carried to it: a work filter, or a document to open', async () => {
  const { routeFromHash, pageFromHash } = await load()
  assert.deepEqual(routeFromHash('#orders?work=toShip', KEYS), { page: 'orders', query: { work: 'toShip' } })
  assert.deepEqual(routeFromHash('#orders?open=0000001003', KEYS), { page: 'orders', query: { open: '0000001003' } })
  assert.equal(pageFromHash('#orders?work=toShip', KEYS), 'orders')
  assert.deepEqual(routeFromHash('#orders', KEYS), { page: 'orders', query: {} })
  assert.deepEqual(routeFromHash('#nope?work=x', KEYS), { page: null, query: {} })
})

test('hashFor writes the same shape back, leaving out empty values', async () => {
  const { hashFor, routeFromHash } = await load()
  assert.equal(hashFor('orders', { work: 'toShip' }), 'orders?work=toShip')
  assert.equal(hashFor('orders', { work: '', open: undefined }), 'orders')
  assert.equal(hashFor('events'), 'events')
  const round = routeFromHash(`#${hashFor('products', { open: 'P000001' })}`, KEYS)
  assert.deepEqual(round, { page: 'products', query: { open: 'P000001' } })
})
