/*
 * Money as every screen shows it. The expectations follow en-GB, as format-stamp's do.
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')

async function load () {
  return import('../screen/src/money.js')
}

test('an amount reads as money in the record\'s own currency', async () => {
  const { money } = await load()
  assert.equal(money(1316, 'USD'), '$1,316.00')
  assert.equal(money(89.5, 'EUR'), '€89.50')
})

test('no currency falls back to dollars rather than throwing', async () => {
  const { money } = await load()
  assert.equal(money(10), '$10.00')
  assert.equal(money(10, null), '$10.00')
  assert.equal(money(10, ''), '$10.00')
})

test('nothing, or something unreadable, is zero — never NaN on screen', async () => {
  const { money } = await load()
  assert.equal(money(null, 'USD'), '$0.00')
  assert.equal(money(undefined, 'USD'), '$0.00')
  assert.equal(money('not money', 'USD'), '$0.00')
})

test('zero is an amount', async () => {
  const { money } = await load()
  assert.equal(money(0, 'USD'), '$0.00')
})

test('the options a Spectrum number field takes are the same ones', async () => {
  const { moneyOptions } = await load()
  assert.deepEqual(moneyOptions('EUR'), { style: 'currency', currency: 'EUR' })
  assert.deepEqual(moneyOptions(), { style: 'currency', currency: 'USD' })
})
