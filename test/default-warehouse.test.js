/*
 * The warehouse a shipment ships from when none was named (lib/fulfilment defaultWarehouse,
 * AB-49): the one that holds every shipped line when exactly one does; else the fullest across
 * the shipped lines; null only when nothing holds them. Deterministic, so an API- or
 * agent-created shipment names a source Commerce can ship from.
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { defaultWarehouse } = require('../lib/fulfilment')

const product = (warehouses) => ({ warehouses: Object.entries(warehouses).map(([code, quantity]) => ({ code, quantity })) })
const products = (map) => new Map(Object.entries(map).map(([sku, w]) => [sku, product(w)]))
const lines = (...skus) => skus.map((sku) => ({ sku }))

test('every shipped product in one warehouse: that warehouse', () => {
  assert.equal(defaultWarehouse(products({ A1: { north: 5 }, B2: { north: 2 } }), lines('A1', 'B2')), 'north')
})

test('products in several warehouses with one common to all: the common one, not the fullest', () => {
  const stock = products({ A1: { north: 50, south: 1 }, B2: { south: 1 } })
  assert.equal(defaultWarehouse(stock, lines('A1', 'B2')), 'south')
})

test('no warehouse holds every line: the one with the most stock across the shipped lines', () => {
  const stock = products({ A1: { north: 3 }, B2: { south: 10 } })
  assert.equal(defaultWarehouse(stock, lines('A1', 'B2')), 'south')
})

test('a warehouse with nothing on the shelf does not count; none at all is null', () => {
  assert.equal(defaultWarehouse(products({ A1: { north: 0, south: 4 } }), lines('A1')), 'south')
  assert.equal(defaultWarehouse(products({ A1: { north: 0 } }), lines('A1')), null)
  assert.equal(defaultWarehouse(new Map([['A1', null]]), lines('A1')), null)
})

test('a tie on stock is broken by code, so two runs choose the same warehouse', () => {
  assert.equal(defaultWarehouse(products({ A1: { west: 5 }, B2: { east: 5 } }), lines('A1', 'B2')), 'east')
})

test('the same SKU on two lines counts once', () => {
  assert.equal(defaultWarehouse(products({ A1: { north: 1, south: 9 } }), lines('A1', 'A1')), 'south')
})
