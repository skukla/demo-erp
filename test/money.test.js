/*
 * Money as every screen shows it. An ERP names its currency by ISO code, not a symbol
 * (SAP's currency key, Business Central's currency code), so money reads "USD 1,316.00".
 * Intl separates the code from the figure with a non-breaking space (U+00A0), which the
 * expectations spell out.
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')

const NB = ' ' // the non-breaking space Intl puts between the code and the figure

async function load () {
  return import('../screen/src/money.js')
}

test('an amount reads as money in the record\'s own currency, by ISO code', async () => {
  const { money } = await load()
  assert.equal(money(1316, 'USD'), `USD${NB}1,316.00`)
  assert.equal(money(89.5, 'EUR'), `EUR${NB}89.50`)
})

test('no currency falls back to the ERP default rather than throwing', async () => {
  const { money } = await load()
  assert.equal(money(10), `USD${NB}10.00`)
  assert.equal(money(10, null), `USD${NB}10.00`)
  assert.equal(money(10, ''), `USD${NB}10.00`)
})

test('nothing, or something unreadable, is zero — never NaN on screen', async () => {
  const { money } = await load()
  assert.equal(money(null, 'USD'), `USD${NB}0.00`)
  assert.equal(money(undefined, 'USD'), `USD${NB}0.00`)
  assert.equal(money('not money', 'USD'), `USD${NB}0.00`)
})

test('zero is an amount', async () => {
  const { money } = await load()
  assert.equal(money(0, 'USD'), `USD${NB}0.00`)
})

test('the options a Spectrum number field takes are the same ones', async () => {
  const { moneyOptions } = await load()
  assert.deepEqual(moneyOptions('EUR'), { style: 'currency', currency: 'EUR', currencyDisplay: 'code' })
  assert.deepEqual(moneyOptions(), { style: 'currency', currency: 'USD', currencyDisplay: 'code' })
})
