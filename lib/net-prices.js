/*
 * Prices in force as the ERP would CHARGE them: what a subscriber (the web shop integration)
 * is sent for a customer. Pure over the records it is handed, so it is tested without a
 * database; lib/contracts reads the store and calls it.
 *
 * Every product and quantity is priced by lib/pricing's own decision (`decide`), the one a
 * quote uses, so the two cannot disagree: the customer's own price list, then its price
 * group's, then its loose contract price or discount (SKU-specific before all-products), then
 * the list price; the maximum discount bounds every result. Loose conditions count only on
 * the day's date, and from their minimum quantity, as list lines do.
 *
 * The answer keeps the published line shape (lib/contract-prices): a price stays a `price`
 * line and a discount a `discount` line, so a discount keeps following the list price on
 * the subscriber's side. A result the ceiling cut is sent as a discount of the ceiling's percent: that is
 * the floor, list × (1 − ceiling), and it follows the list price too. A line a price list set
 * names the list (`contractNumber`, `appliesTo`); a line a loose condition set has
 * `contractNumber: null` and `appliesTo: 'customer'` (a loose condition prices only the
 * customer it names). A product's quantity breaks are the minimum quantities of its list
 * lines and conditions; a break is a line only where the charged price moves.
 *
 * Products: every product the ERP sells (a configurable parent sells nothing, its variants
 * do), so an all-products discount is one line per product; plus a parent a list line or a
 * condition names itself.
 *
 * Not published: a condition scoped to a sales organization. A company's one shared catalog
 * serves every website, so such a condition prices the order through that organization
 * (the quote and order paths pass it) and stays out of the catalog (review, 2026-09-30).
 */
const { partnerPricesInForce, appliesToOf } = require('./contract-prices')
const { decide, matches } = require('./pricing')

/** The lists that can price this customer: its own, and its price group's. */
function listsOf (lists, customer) {
  return lists.filter((l) => (appliesToOf(l) === 'customer' && l.partnerId === customer.id) ||
    (appliesToOf(l) === 'priceGroup' && customer.priceGroup && l.priceGroup === customer.priceGroup))
}

/** The products to price: every one that sells, and any other a line or condition names. */
function productsOf (products, named) {
  return products.filter((p) => p.type !== 'configurable' || named.has(p.sku))
}

/** The quantities where this product's price can move: 1, and each minimum quantity (of the conditions that apply to this sales organization, when given). */
function breaksOf (sku, listed, conditions, customerId, salesOrg) {
  const breaks = new Set([1])
  for (const line of listed) if (line.sku === sku) breaks.add(line.minQty)
  for (const c of conditions) if (c.minQty && matches(c, customerId, sku, salesOrg)) breaks.add(Number(c.minQty))
  return [...breaks].sort((a, b) => a - b)
}

/** The value a decision sends, or null when the customer pays the list price. */
function valueOf (decision) {
  if (decision.source === 'list') return null
  if (decision.source === 'contractPrice') return { kind: 'price', price: decision.amount }
  return decision.percent > 0 ? { kind: 'discount', percent: decision.percent } : null
}

/** Where a line came from: the price list whose line set it, or the customer's loose conditions. */
function originOf (decision) {
  const term = decision.terms.term
  return term ? { contractNumber: term.contractNumber, appliesTo: term.appliesTo } : { contractNumber: null, appliesTo: 'customer' }
}

/**
 * One customer's prices in force on a day.
 *
 * @param {object} args `{ products, conditions, lists, customer: { id, priceGroup? }, date }`
 * @returns {object[]} `{ sku, kind, price | percent, minQty, contractNumber, appliesTo }`, by product then quantity
 */
function netPricesFor ({ products, conditions, lists, customer, date, salesOrgs = [] }) {
  const partner = { id: customer.id, priceGroup: customer.priceGroup || null }
  const contracts = listsOf(lists, partner)
  const theirs = conditions.filter((c) => !c.partnerId || c.partnerId === partner.id)
  // A condition scoped to a sales organization prices that organization's websites only
  // (contract version 12, AB-46). A web shop keeps a website on each customer tier
  // price, so a customer with any scoped condition gets one WHOLE set per sales organization,
  // each line tagged with it, and no untagged set — an untagged row beside a tagged one for
  // the same product would leave the subscriber to choose. A customer with none keeps one untagged
  // set, as before. A scoped condition when the ERP knows no sales organizations (no
  // business structure mirrored yet) cannot be placed and is left out rather than published
  // everywhere: it still prices the order, which passes its organization to lib/pricing.
  // Every line carries salesOrg (the contract's exact keys): null is "for every website".
  const everywhere = (lines) => lines.map((line) => ({ ...line, salesOrg: null }))
  const scoped = theirs.some((c) => c.salesOrg)
  if (!scoped) return everywhere(linesFor({ products, contracts, theirs, partner, date }))
  if (salesOrgs.length === 0) return everywhere(linesFor({ products, contracts, theirs: theirs.filter((c) => !c.salesOrg), partner, date }))
  return [...salesOrgs].sort().flatMap((salesOrg) =>
    linesFor({ products, contracts, theirs, partner, date, salesOrg }).map((line) => ({ ...line, salesOrg })))
}

/** One set of lines: every product and quantity break priced by lib/pricing's decision, for one sales organization when given. */
function linesFor ({ products, contracts, theirs, partner, date, salesOrg }) {
  const listed = partnerPricesInForce(contracts, partner, date)
  const named = new Set([...listed.map((l) => l.sku), ...theirs.filter((c) => c.sku).map((c) => c.sku)])
  const lines = []
  for (const product of productsOf(products, named)) {
    let previous = null
    for (const qty of breaksOf(product.sku, listed, theirs, partner.id, salesOrg)) {
      const decision = decide({ product, partner, conditions: theirs, contracts, qty, date, salesOrg })
      const value = valueOf(decision)
      const key = JSON.stringify(value)
      if (value && key !== previous) lines.push({ sku: product.sku, ...value, minQty: qty, ...originOf(decision) })
      previous = key
    }
  }
  return lines.sort((a, b) => (a.sku === b.sku ? a.minQty - b.minQty : (a.sku < b.sku ? -1 : 1)))
}

/**
 * Every customer's prices in force on a day.
 *
 * @param {object} args `{ products, conditions, lists, customers: [{ id, priceGroup? }], date, salesOrgs? }`
 * @returns {Array<{ partnerId: string, lines: object[] }>} customers with at least one line, by id
 */
function netPricesInForce ({ products, conditions, lists, customers, date, salesOrgs = [] }) {
  return [...customers]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((c) => ({ partnerId: c.id, lines: netPricesFor({ products, conditions, lists, customer: c, date, salesOrgs }) }))
    .filter((item) => item.lines.length > 0)
}

module.exports = { netPricesFor, netPricesInForce }
