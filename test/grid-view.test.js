/*
 * The search and the sort every grid on the screen shares.
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')

async function load () {
  return import('../screen/src/gridView.js')
}

const ROWS = [
  { sku: 'P000010', name: 'Wide-leg trouser', price: 89, stock: 4 },
  { sku: 'P000002', name: 'Cotton shirt', price: 34.2, stock: 120 },
  { sku: 'P000100', name: 'Acme canvas tote', price: 12, stock: 0 }
]

const FIELDS = [(p) => p.sku, (p) => p.name]
const VALUES = { sku: (p) => p.sku, name: (p) => p.name, price: (p) => p.price }
const view = (extra) => ({ fields: FIELDS, values: VALUES, ...extra })

const skus = (rows) => rows.map((r) => r.sku)

test('no rows yet reads as an empty grid, never null', async () => {
  const { applyView } = await load()
  assert.deepEqual(applyView(null, view()), [])
  assert.deepEqual(applyView(undefined, view()), [])
})

test('an empty search shows everything, in the order given', async () => {
  const { applyView } = await load()
  assert.deepEqual(skus(applyView(ROWS, view({ text: '' }))), ['P000010', 'P000002', 'P000100'])
  assert.deepEqual(skus(applyView(ROWS, view({ text: '   ' }))), ['P000010', 'P000002', 'P000100'])
})

test('search looks through every field a grid names, ignoring case', async () => {
  const { applyView } = await load()
  assert.deepEqual(skus(applyView(ROWS, view({ text: 'trouser' }))), ['P000010'])
  assert.deepEqual(skus(applyView(ROWS, view({ text: 'TROUSER' }))), ['P000010'])
  assert.deepEqual(skus(applyView(ROWS, view({ text: 'P000002' }))), ['P000002'])
})

test('several words match in any order, and all of them must match', async () => {
  const { applyView } = await load()
  assert.deepEqual(skus(applyView(ROWS, view({ text: 'canvas acme' }))), ['P000100'])
  assert.deepEqual(skus(applyView(ROWS, view({ text: 'acme trouser' }))), [])
})

test('a term nothing holds finds nothing', async () => {
  const { applyView } = await load()
  assert.deepEqual(applyView(ROWS, view({ text: 'zzz' })), [])
})

test('sorting a text column puts 2 before 10, as a person reads it', async () => {
  const { applyView } = await load()
  const sorted = applyView(ROWS, view({ sort: { column: 'sku', direction: 'ascending' } }))
  assert.deepEqual(skus(sorted), ['P000002', 'P000010', 'P000100'])
})

test('descending reverses it', async () => {
  const { applyView } = await load()
  const sorted = applyView(ROWS, view({ sort: { column: 'sku', direction: 'descending' } }))
  assert.deepEqual(skus(sorted), ['P000100', 'P000010', 'P000002'])
})

test('a number column sorts as numbers, not as text', async () => {
  const { applyView } = await load()
  const sorted = applyView(ROWS, view({ sort: { column: 'price', direction: 'ascending' } }))
  assert.deepEqual(sorted.map((r) => r.price), [12, 34.2, 89])
})

test('a column the grid does not name leaves the order alone', async () => {
  const { applyView } = await load()
  const sorted = applyView(ROWS, view({ sort: { column: 'nothing', direction: 'ascending' } }))
  assert.deepEqual(skus(sorted), ['P000010', 'P000002', 'P000100'])
})

test('search and sort apply together', async () => {
  const { applyView } = await load()
  const shown = applyView(ROWS, view({ text: 'p0000', sort: { column: 'price', direction: 'descending' } }))
  // Only P000010 and P000002 carry four zeros after the P; P000100 does not.
  assert.deepEqual(shown.map((r) => r.price), [89, 34.2])
})

test('sorting does not reorder the caller\'s own array', async () => {
  const { applyView } = await load()
  const given = [...ROWS]
  applyView(given, view({ sort: { column: 'sku', direction: 'ascending' } }))
  assert.deepEqual(skus(given), ['P000010', 'P000002', 'P000100'])
})

test('a missing value sorts without throwing', async () => {
  const { applyView } = await load()
  const rows = [{ sku: 'B' }, { sku: undefined }, { sku: 'A' }]
  const sorted = applyView(rows, {
    fields: [(r) => r.sku],
    values: { sku: (r) => r.sku },
    sort: { column: 'sku', direction: 'ascending' }
  })
  assert.equal(sorted.length, 3)
})
