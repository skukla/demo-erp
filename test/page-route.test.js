/*
 * Which area the address bar is asking for.
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')

async function load () {
  return import('../screen/src/pageRoute.js')
}

const KEYS = ['dashboard', 'products', 'partners', 'orders', 'pricing', 'events', 'settings']

test('an area in the hash is the area asked for', async () => {
  const { pageFromHash } = await load()
  assert.equal(pageFromHash('#pricing', KEYS), 'pricing')
  assert.equal(pageFromHash('#dashboard', KEYS), 'dashboard')
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
