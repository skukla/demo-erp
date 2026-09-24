/*
 * Contract pricing. Pure over the records it is handed, so it is tested without a
 * database. A pricing condition is one of:
 *   { kind: 'contractPrice', partnerId, sku, price }              a partner's price for a product
 *   { kind: 'contractDiscount', partnerId, sku?: null, percent }  a partner's discount, all products when sku is null
 *   { kind: 'maxDiscount', partnerId?: null, sku?: null, percent } the ceiling: most specific match wins
 */

const DEFAULT_MAX_DISCOUNT = 100

/** Today as YYYY-MM-DD, the date a quote prices on when none is given. */
function today () {
  return new Date().toISOString().slice(0, 10)
}

/** "1 Oct 2026" — a date in a sentence. */
function dayText (day) {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`))
}

/** Specificity: partner+sku beats partner beats sku beats global. */
function specificity (condition) {
  return (condition.partnerId ? 2 : 0) + (condition.sku ? 1 : 0)
}

/** Does the record name this customer and product (or leave them open)? */
function matches (condition, partnerId, sku) {
  const partnerOk = !condition.partnerId || condition.partnerId === partnerId
  const skuOk = !condition.sku || condition.sku === sku
  return partnerOk && skuOk
}

/**
 * Why a record that names this customer and product still does not apply on this line,
 * or null when it does. Validity is checked on the DOCUMENT's date — the order's date
 * for an order, today for a quote — as both reference systems do.
 */
function ruledOut (condition, { date, qty }) {
  if (condition.validFrom && date < condition.validFrom) return `not valid until ${dayText(condition.validFrom)}`
  if (condition.validTo && date > condition.validTo) return `expired on ${dayText(condition.validTo)}`
  if (condition.minQty && qty < condition.minQty) return `minimum quantity ${condition.minQty}, this line is ${qty}`
  return null
}

/** active · scheduled · expired, on a date. The status column on the conditions list. */
function conditionStatus (condition, date = today()) {
  if (condition.validFrom && date < condition.validFrom) return 'scheduled'
  if (condition.validTo && date > condition.validTo) return 'expired'
  return 'active'
}

function mostSpecific (conditions, kind, partnerId, sku, context = { date: today(), qty: 1 }) {
  return conditions
    .filter((c) => c.kind === kind && matches(c, partnerId, sku) && !ruledOut(c, context))
    .sort((a, b) => specificity(b) - specificity(a))[0]
}

/** @returns {number} rounded to cents */
function round2 (n) {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * Price one line for a partner.
 *
 * @param {object} args `{ product, partner, conditions, qty }`
 * @returns {object} `{ sku, qty, listPrice, contractPrice, discountPercent, maxDiscountPercent, source }`
 */
function priceLine ({ product, partner, conditions, qty = 1, date = today() }) {
  const partnerId = partner ? partner.id : undefined
  const sku = product.sku
  const listPrice = Number(product.listPrice) || 0
  const context = { date, qty }
  const price = mostSpecific(conditions, 'contractPrice', partnerId, sku, context)
  const discount = mostSpecific(conditions, 'contractDiscount', partnerId, sku, context)
  const ceiling = mostSpecific(conditions, 'maxDiscount', partnerId, sku, context)
  const maxDiscountPercent = ceiling ? Number(ceiling.percent) : DEFAULT_MAX_DISCOUNT

  let contractPrice = listPrice
  let source = 'list'
  if (price && price.partnerId === partnerId) {
    contractPrice = Number(price.price)
    source = 'contractPrice'
  } else if (discount && discount.partnerId === partnerId) {
    contractPrice = round2(listPrice * (1 - Number(discount.percent) / 100))
    source = 'contractDiscount'
  }
  // The ceiling bounds how far below list a line may go, contract included.
  const floor = round2(listPrice * (1 - maxDiscountPercent / 100))
  if (contractPrice < floor) {
    contractPrice = floor
    source = 'ceiling'
  }
  const discountPercent = listPrice > 0 ? round2(((listPrice - contractPrice) / listPrice) * 100) : 0
  /* SAP's pricing analysis, in one list: every record that named this customer and
     product and did NOT decide the price, each with its reason. A record ruled out by
     date or quantity says so; one outranked by the ladder says what beat it. */
  // What actually decided this line: the ceiling always bounds it; a price beats a
  // discount, so a discount that lost to a price did NOT apply and is reported below.
  const applied = new Set([ceiling, price || discount].filter(Boolean))
  const notApplied = conditions
    .filter((c) => matches(c, partnerId, sku) && !applied.has(c) && (c.partnerId === partnerId || c.kind === 'maxDiscount' || !c.partnerId))
    .map((c) => ({ id: c._id, kind: c.kind, reason: ruledOut(c, context) || outranked(c, { price, discount, ceiling }) }))
    .filter((c) => c.reason)
  return { sku, qty, listPrice, contractPrice: round2(contractPrice), discountPercent, maxDiscountPercent, source, lineTotal: round2(contractPrice * qty), notApplied }
}

/** Why a valid record still lost: the ladder. */
function outranked (condition, { price, discount, ceiling }) {
  if (condition.kind === 'contractDiscount' && price) return 'a contract price takes precedence'
  if (condition.kind === 'contractPrice' && price) return 'a more specific contract price applies'
  if (condition.kind === 'contractDiscount' && discount) return 'a more specific discount applies'
  if (condition.kind === 'maxDiscount' && ceiling) return 'a more specific discount limit applies'
  return null
}

/**
 * Quote a set of lines.
 *
 * @returns {object} `{ partnerId, lines, total }`
 */
function quote ({ products, partner, conditions, lines, date = today() }) {
  const bySku = new Map(products.map((m) => [m.sku, m]))
  const priced = []
  for (const line of lines) {
    const product = bySku.get(line.sku)
    if (!product) {
      priced.push({ sku: line.sku, qty: line.qty ?? 1, unknown: true })
      continue
    }
    priced.push(priceLine({ product, partner, conditions, qty: line.qty ?? 1, date }))
  }
  const total = round2(priced.reduce((sum, l) => sum + (l.lineTotal || 0), 0))
  return { partnerId: partner ? partner.id : null, date, lines: priced, total }
}

module.exports = { DEFAULT_MAX_DISCOUNT, specificity, matches, mostSpecific, round2, priceLine, quote, conditionStatus, ruledOut, today, dayText }
