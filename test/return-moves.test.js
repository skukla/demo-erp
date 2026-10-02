/*
 * Which move a return order or an invoice offers in its state: the one rule the screen's
 * buttons and Home's cues both read, so a cue cannot count a document whose button is not
 * there. Open → Receive; received → Post credit memo; credited → nothing. An invoice offers
 * its whole-invoice credit until it is credited.
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { returnMoves, canCreditInvoice } = require('../lib/return-moves')

test('an open return order offers Receive and nothing else', () => {
  assert.deepEqual(returnMoves({ status: 'open' }), { receive: true, credit: false })
})

test('a received return order offers its credit memo and nothing else', () => {
  assert.deepEqual(returnMoves({ status: 'received' }), { receive: false, credit: true })
})

test('a credited return order offers nothing; nor does no return order at all', () => {
  assert.deepEqual(returnMoves({ status: 'credited' }), { receive: false, credit: false })
  assert.deepEqual(returnMoves(null), { receive: false, credit: false })
})

test('an invoice offers its credit memo until it is credited', () => {
  assert.equal(canCreditInvoice({ number: '9000000001', status: 'open' }), true)
  assert.equal(canCreditInvoice({ number: '9000000001', status: 'credited', creditMemo: '9500000001' }), false)
  assert.equal(canCreditInvoice(null), false)
})

test('an invoice offers Post payment while something is open on it (contract version 14)', () => {
  const { canPayInvoice } = require('../lib/return-moves')
  assert.equal(canPayInvoice({ number: '9000000001', openAmount: 42.42, paymentStatus: 'open' }), true)
  assert.equal(canPayInvoice({ number: '9000000001', openAmount: 2.42, paymentStatus: 'partly paid' }), true)
  assert.equal(canPayInvoice({ number: '9000000001', openAmount: 0, paymentStatus: 'paid' }), false)
  assert.equal(canPayInvoice({ number: '9000000001', openAmount: 0, paymentStatus: 'credited' }), false)
  assert.equal(canPayInvoice({ number: null, legacy: true }), false)
  assert.equal(canPayInvoice(null), false)
})
