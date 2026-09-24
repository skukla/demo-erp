/*
 * Credit, the way the reference systems do it (plan §6.1).
 *
 * SAP does not refuse an over-limit order. It creates it and BLOCKS it, and a person
 * releases or rejects it; the block stops the next document, not the current one.
 * Business Central's Blocked field is graduated — Ship, Invoice, All — and each level says
 * which documents may still be created. Both are here, in plain words.
 *
 * Nothing is stored that could drift: exposure is worked out from the orders on read
 * (lib/partners exposureOf); only the DECISION on an order is stored, because a release is
 * something a person did.
 *
 * All of it is absent for a customer with no Commerce company. There is no credit
 * relationship to describe, so there is nothing to hold.
 */

/** Business Central's four levels, in plainer words. */
const BLOCKING = ['open', 'shipping', 'invoicing', 'all']

/** Which blocking levels stop which document. */
const STOPS = {
  order: new Set(['shipping', 'invoicing', 'all']),
  shipment: new Set(['shipping', 'invoicing', 'all']),
  invoice: new Set(['invoicing', 'all'])
}

/** A customer has credit when it is a Commerce company; the walk-in account never does. */
function hasCredit (partner) {
  return Boolean(partner) && partner.commerceCompanyId !== null && partner.commerceCompanyId !== undefined
}

/** "1,000.00" — a money figure for a sentence, without a currency the ERP does not have yet. */
function amount (value) {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0)
}

/** "blocked for shipping" · "blocked for invoicing" · "blocked for all business" */
function blockedText (level) {
  return level === 'all' ? 'blocked for all business' : `blocked for ${level}`
}

/**
 * The decision on a new order.
 *
 * @param {object} args `partner` (upgraded), `exposure` (net of the customer's open orders,
 *   before this one), `net` (this order's net amount)
 * @returns {{ status: 'approved'|'held'|null, reason: string|null }} null when there is no credit
 */
function decide ({ partner, exposure, net }) {
  if (!hasCredit(partner)) return { status: null, reason: null }
  if (STOPS.order.has(partner.blocking)) {
    return { status: 'held', reason: `Customer ${blockedText(partner.blocking)}` }
  }
  const limit = Number(partner.creditLimit) || 0
  const over = Math.round((exposure + net - limit) * 100) / 100
  if (over > 0) return { status: 'held', reason: `Credit limit ${amount(limit)} exceeded by ${amount(over)}` }
  return { status: 'approved', reason: null }
}

/**
 * Why a customer's blocking level refuses a document, or null when it does not.
 *
 * @param {object} partner the upgraded partner
 * @param {'shipment'|'invoice'} document
 * @returns {string|null} e.g. "Customer C1 is blocked for shipping."
 */
function blockingRefusal (partner, document) {
  if (!hasCredit(partner)) return null
  if (!STOPS[document].has(partner.blocking)) return null
  return `Customer ${partner.id} is ${blockedText(partner.blocking)}.`
}

module.exports = { BLOCKING, STOPS, hasCredit, amount, decide, blockingRefusal }
