/*
 * Contract pricing. Pure over the records it is handed, so it is tested without a
 * database. A pricing condition is one of:
 *   { kind: 'contractPrice', partnerId, sku, price }              a partner's price for a product
 *   { kind: 'contractDiscount', partnerId, sku?: null, percent }  a partner's discount, all products when sku is null
 *   { kind: 'maxDiscount', partnerId?: null, sku?: null, percent } the ceiling: most specific match wins
 *
 * CUSTOMER PRICE LISTS (lib/contracts) come first, most specific first: the customer's own
 * lists, then its price group's (lib/contract-prices resolves the two). When the customer has
 * list lines in force on the document's date for a product, they take the place of its loose
 * contract prices and discounts for that product (the product's own and the all-products
 * discount alike): the price list owns that customer's price for that product. The line
 * priced is the one with the highest minimum quantity the quantity reaches; below every one
 * of them the list price stands. With no list line for the product, the loose conditions
 * price it as before, then the list price. The maximum discount stays a loose, store-wide
 * rule and still bounds the result, price list or not.
 */
const { partnerPricesInForce } = require('./contract-prices')

const DEFAULT_MAX_DISCOUNT = 100

/**
 * Today as YYYY-MM-DD, the date a quote prices on when none is given: the ERP's local date in
 * its time zone (settings.timeZone), as a real ERP prices by the company's own day. UTC when
 * none is given or the name is not one Intl knows.
 *
 * @param {string} [timeZone] an IANA time zone, e.g. America/New_York
 * @param {Date} [now] the moment (tests)
 * @returns {string} the local date
 */
function today (timeZone = 'UTC', now = new Date()) {
  try {
    // en-CA writes dates as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  } catch {
    return now.toISOString().slice(0, 10)
  }
}

/** "1 Oct 2026" — a date in a sentence. */
function dayText (day) {
  return new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`))
}

/** Specificity: a sales organisation scope beats partner+sku beats partner beats sku beats global. */
function specificity (condition) {
  return (condition.salesOrg ? 4 : 0) + (condition.partnerId ? 2 : 0) + (condition.sku ? 1 : 0)
}

/** Does the record name this customer, product and sales organisation (or leave them open)? */
function matches (condition, partnerId, sku, salesOrg) {
  const partnerOk = !condition.partnerId || condition.partnerId === partnerId
  const skuOk = !condition.sku || condition.sku === sku
  const orgOk = !condition.salesOrg || !salesOrg || condition.salesOrg === salesOrg
  return partnerOk && skuOk && orgOk
}

/** Why a record scoped to another sales organisation does not apply, or null. */
function otherSalesOrg (condition, salesOrg) {
  if (condition.salesOrg && salesOrg && condition.salesOrg !== salesOrg) return `for sales organization ${condition.salesOrg}; this is ${salesOrg}`
  return null
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
    .filter((c) => c.kind === kind && matches(c, partnerId, sku, context.salesOrg) && !ruledOut(c, context))
    .sort((a, b) => specificity(b) - specificity(a))[0]
}

/** @returns {number} rounded to cents */
function round2 (n) {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/**
 * The customer's contract terms for one product: the line that prices this quantity (or
 * none), and the loose conditions the contract sets aside.
 */
function contractTerms ({ contracts, conditions, partner, sku, qty, date }) {
  const partnerId = partner ? partner.id : undefined
  const customer = partner ? { id: partner.id, priceGroup: partner.priceGroup || null } : null
  const owned = customer ? partnerPricesInForce(contracts, customer, date).filter((l) => l.sku === sku) : []
  if (owned.length === 0) return { term: null, setAside: new Set() }
  const term = owned.filter((l) => l.minQty <= qty).sort((a, b) => b.minQty - a.minQty)[0] || null
  const setAside = new Set(conditions.filter((c) => (c.kind === 'contractPrice' || c.kind === 'contractDiscount') && c.partnerId === partnerId && (!c.sku || c.sku === sku)))
  return { term, setAside, number: owned[0].contractNumber }
}

/**
 * The price before the ceiling, and what set it: a contract line, a loose condition, or the
 * list. A discount also says its percent, so a subscriber can be sent the discount itself.
 */
function basePrice ({ listPrice, term, price, discount, partnerId }) {
  if (term && term.kind === 'price') return { amount: Number(term.price), source: 'contractPrice' }
  if (term) return { amount: round2(listPrice * (1 - Number(term.percent) / 100)), source: 'contractDiscount', percent: Number(term.percent) }
  if (price && price.partnerId === partnerId) return { amount: Number(price.price), source: 'contractPrice' }
  if (discount && discount.partnerId === partnerId) return { amount: round2(listPrice * (1 - Number(discount.percent) / 100)), source: 'contractDiscount', percent: Number(discount.percent) }
  return { amount: listPrice, source: 'list' }
}

/**
 * The decision for one product and quantity, by the precedence in this file's header: the
 * amount charged, what set it (contractPrice, contractDiscount, ceiling or list), the percent
 * when a discount or the ceiling set it, and the records that took part. A quote's line and
 * the prices in force (lib/net-prices) are both read from it, so the two cannot disagree.
 *
 * @param {object} args `{ product, partner, conditions, contracts, qty, date, salesOrg }`
 * @returns {object} `{ amount, source, percent?, listPrice, maxDiscountPercent, terms, price, discount, ceiling, context }`
 */
function decide ({ product, partner, conditions, contracts = [], qty = 1, date = today(), salesOrg }) {
  const partnerId = partner ? partner.id : undefined
  const sku = product.sku
  const listPrice = Number(product.listPrice) || 0
  const context = { date, qty, salesOrg }
  const terms = contractTerms({ contracts, conditions, partner, sku, qty, date })
  const loose = conditions.filter((c) => !terms.setAside.has(c))
  const price = mostSpecific(loose, 'contractPrice', partnerId, sku, context)
  const discount = mostSpecific(loose, 'contractDiscount', partnerId, sku, context)
  const ceiling = mostSpecific(conditions, 'maxDiscount', partnerId, sku, context)
  const maxDiscountPercent = ceiling ? Number(ceiling.percent) : DEFAULT_MAX_DISCOUNT
  const records = { listPrice, maxDiscountPercent, terms, price, discount, ceiling, context }
  const base = basePrice({ listPrice, term: terms.term, price, discount, partnerId })
  // The ceiling bounds how far below list a line may go, contract included.
  const floor = round2(listPrice * (1 - maxDiscountPercent / 100))
  if (base.amount < floor) return { ...records, amount: floor, source: 'ceiling', percent: maxDiscountPercent }
  return { ...records, ...base }
}

/**
 * Price one line for a partner.
 *
 * @param {object} args `{ product, partner, conditions, contracts, qty, date, salesOrg }`
 * @returns {object} `{ sku, qty, listPrice, contractPrice, discountPercent, maxDiscountPercent, source, lineTotal, notApplied, contractNumber }`
 */
function priceLine ({ product, partner, conditions, contracts = [], qty = 1, date = today(), salesOrg }) {
  const partnerId = partner ? partner.id : undefined
  const sku = product.sku
  const decision = decide({ product, partner, conditions, contracts, qty, date, salesOrg })
  const { listPrice, maxDiscountPercent, terms, price, discount, ceiling, context, source } = decision
  const contractPrice = decision.amount
  const discountPercent = listPrice > 0 ? round2(((listPrice - contractPrice) / listPrice) * 100) : 0
  /* SAP's pricing analysis, in one list: every record that named this customer and
     product and did NOT decide the price, each with its reason. A record ruled out by
     date or quantity says so; one outranked by the ladder says what beat it. */
  // What actually decided this line: the ceiling always bounds it; a price beats a
  // discount, so a discount that lost to a price did NOT apply and is reported below.
  const applied = new Set([ceiling, price || discount].filter(Boolean))
  const notApplied = conditions
    .filter((c) => matches(c, partnerId, sku) && !applied.has(c) && (c.partnerId === partnerId || c.kind === 'maxDiscount' || !c.partnerId))
    .map((c) => ({ id: c._id, kind: c.kind, reason: ruledOut(c, context) || otherSalesOrg(c, salesOrg) || setAsideBy(c, terms) || outranked(c, { price, discount, ceiling }) }))
    .filter((c) => c.reason)
  const contractNumber = terms.term ? terms.term.contractNumber : null
  return { sku, qty, listPrice, contractPrice: round2(contractPrice), discountPercent, maxDiscountPercent, source, lineTotal: round2(contractPrice * qty), notApplied, contractNumber }
}

/** Why a loose condition gave way to the customer's contract, or null. */
function setAsideBy (condition, terms) {
  return terms.setAside.has(condition) ? `price list ${terms.number} prices this product for this customer` : null
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
function quote ({ products, partner, conditions, contracts = [], lines, date = today(), salesOrg }) {
  const bySku = new Map(products.map((m) => [m.sku, m]))
  const priced = []
  for (const line of lines) {
    const product = bySku.get(line.sku)
    if (!product) {
      priced.push({ sku: line.sku, qty: line.qty ?? 1, unknown: true })
      continue
    }
    priced.push(priceLine({ product, partner, conditions, contracts, qty: line.qty ?? 1, date, salesOrg }))
  }
  const total = round2(priced.reduce((sum, l) => sum + (l.lineTotal || 0), 0))
  return { partnerId: partner ? partner.id : null, date, salesOrg: salesOrg || null, lines: priced, total }
}

module.exports = { DEFAULT_MAX_DISCOUNT, specificity, matches, mostSpecific, round2, decide, priceLine, quote, conditionStatus, ruledOut, today, dayText }
