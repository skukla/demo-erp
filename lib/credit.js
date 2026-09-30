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

/** Every customer has credit but the walk-in account, which never does. */
function hasCredit (partner) {
  return Boolean(partner) && !partner.isDefault
}

/** "USD 1,000.00" — a money figure for a sentence, in the ERP's currency (bare when none given). */
function amount (value, currency) {
  const figure = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0)
  return currency ? `${currency} ${figure}` : figure
}

/** "blocked for shipping" · "blocked for invoicing" · "blocked for all business" */
function blockedText (level) {
  return level === 'all' ? 'blocked for all business' : `blocked for ${level}`
}

/**
 * The decision on a new order.
 *
 * @param {object} args `partner` (upgraded), `exposure` (net of the customer's open orders,
 *   before this one), `net` (this order's net amount), `currency` (the order's, for the reason)
 * @returns {{ status: 'approved'|'held'|null, reason: string|null }} null when there is no credit
 */
function decide ({ partner, exposure, net, currency }) {
  if (!hasCredit(partner)) return { status: null, reason: null }
  // Either switch stops an order: the website account closed in Commerce, or this ERP's own
  // credit block.
  if (partner.websiteAccount === 'closed') {
    return { status: 'held', reason: 'Customer\'s website account is closed in Commerce' }
  }
  if (STOPS.order.has(partner.blocking)) {
    return { status: 'held', reason: `Customer ${blockedText(partner.blocking)}` }
  }
  const limit = Number(partner.creditLimit) || 0
  const over = Math.round((exposure + net - limit) * 100) / 100
  if (over > 0) return { status: 'held', reason: `Credit limit ${amount(limit, currency)} exceeded by ${amount(over, currency)}` }
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

/**
 * The live credit check at order placement (AB-20). The same verdict decide() gives, but
 * asked WITHOUT creating the order — so checkout can refuse before the order is committed,
 * where createOrder instead creates and holds (§6.1). Adds the numbers a shopper acts on;
 * a customer with no credit relationship (the walk-in account) has null limit and available.
 *
 * @param {object} args `partner` (upgraded), `exposure` (net of open orders), `net` (the
 *   amount being placed), `currency`
 * @returns {{ partnerId, status, reason, requested, exposure, limit, available }}
 */
function assessCredit ({ partner, exposure = 0, net = 0, currency }) {
  const round = (value) => Math.round((Number(value) || 0) * 100) / 100
  const decision = decide({ partner, exposure, net, currency })
  const limit = hasCredit(partner) ? (Number(partner.creditLimit) || 0) : null
  const used = round(exposure)
  return {
    partnerId: partner ? partner.id : null,
    status: decision.status,
    reason: decision.reason,
    requested: round(net),
    exposure: used,
    limit,
    available: limit === null ? null : round(limit - used)
  }
}

module.exports = { BLOCKING, STOPS, hasCredit, amount, decide, blockingRefusal, assessCredit }
