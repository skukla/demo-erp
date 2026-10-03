/*
 * Paid at checkout (contract version 18, AB-26s; owner 2026-10-02, flow 1): the customer's
 * web shop took the money through its own payment gateway, and the order arrives with a
 * PAYMENT REFERENCE — how it was paid, the gateway's transaction id, the amount captured and,
 * for a card, its brand and last four digits. This is Business Central's web-shop pattern
 * (the shop takes the money, the ERP records a payment against the posted invoice); in SAP
 * the same data sits on the order's payment card tab as a token. The ERP never holds a card
 * number: only the fields named here are kept, and anything longer than four digits where
 * the last four belong is refused.
 *
 * It requires only lib/errors, so lib/orders can read it while creating an order.
 */
const { badRequest } = require('./errors')

/** The reference's fields, in the contract's order (order.payment). */
const FIELDS = ['method', 'reference', 'cardBrand', 'cardLastFour', 'amount']

const MAX_TEXT = 100
const LAST_FOUR = /^\d{4}$/
/* A brand is a name (Visa, American Express, Diners-Club): letters, with spaces or hyphens. */
const BRAND = /^[A-Za-z][A-Za-z -]{0,29}$/

const absent = (value) => value === undefined || value === null

/** Optional words, trimmed; blank or absent is none. */
function textOf (value) {
  if (absent(value)) return null
  return String(value).trim().slice(0, MAX_TEXT) || null
}

function referenceOf (value) {
  const reference = typeof value === 'string' || typeof value === 'number' ? textOf(value) : null
  if (!reference) throw badRequest('payment.reference (the payment reference: the gateway\'s transaction id) is required on an order paid at checkout.')
  return reference
}

function amountOf (value) {
  const amount = typeof value === 'number' ? Math.round(value * 100) / 100 : NaN
  if (!(amount > 0)) throw badRequest('payment.amount must be the amount captured: a number more than 0.')
  return amount
}

function lastFourOf (value) {
  if (absent(value)) return null
  if (typeof value !== 'string' || !LAST_FOUR.test(value)) throw badRequest('payment.cardLastFour must be the last four digits of the card, as text; the ERP never keeps a card number.')
  return value
}

function brandOf (value) {
  if (absent(value)) return null
  if (typeof value !== 'string' || !BRAND.test(value.trim())) throw badRequest('payment.cardBrand must be the card brand\'s name, such as Visa.')
  return value.trim()
}

/**
 * The payment reference a new order carries, or null when it carries none (an order on
 * account, or any order the web shop has not been paid for).
 *
 * @param {unknown} payment the order request's `payment`
 * @returns {{ method: string|null, reference: string, cardBrand: string|null, cardLastFour: string|null, amount: number }|null}
 */
function paymentSent (payment) {
  if (absent(payment)) return null
  if (typeof payment !== 'object' || Array.isArray(payment)) throw badRequest('payment must be the payment reference of an order paid at checkout: { method, reference, cardBrand, cardLastFour, amount }.')
  return {
    method: textOf(payment.method),
    reference: referenceOf(payment.reference),
    cardBrand: brandOf(payment.cardBrand),
    cardLastFour: lastFourOf(payment.cardLastFour),
    amount: amountOf(payment.amount)
  }
}

module.exports = { FIELDS, paymentSent }
