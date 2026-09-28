/*
 * Prices in force: what customer price lists price for a customer on a day. Pure over the
 * lists it is handed, so it is tested without a database; the store is lib/contracts.
 *
 * Business Central's shape (sales price lists): a list applies to ONE customer or to ONE
 * customer price group. A Draft list is "not included in price calculations", nor is an
 * Inactive one; an Active list prices only between its starting and ending dates, and each
 * line only between its own (both days included, either end open). An active list past its
 * ending date prices nothing, without anyone changing its status.
 *
 * SAP's access sequence, simplified, decides between lists: most specific first. For each
 * product and minimum quantity the customer's own lists answer; its price group's lists
 * answer only what the customer's do not.
 *
 * Within one level, when two lines price the same product at the same minimum quantity, the
 * one that STARTED later wins (the line's starting date, else its list's), then the higher
 * list number. So "this price goes up on 1 January" is one dated line added beside the old.
 * A line at another minimum quantity is a quantity break of its own and is kept beside it.
 */

/** A list stored before price groups existed applies to its customer. */
function appliesToOf (list) {
  return list.appliesTo || (list.priceGroup ? 'priceGroup' : 'customer')
}

const within = (date, from, to) => !(from && date < from) && !(to && date > to)

/** Is this list pricing on this day? */
function isInForce (list, date) {
  return Boolean(list) && list.status === 'active' && within(date, list.startingDate, list.endingDate)
}

/** Is this line, of a list in force, pricing on this day? */
function lineInForce (line, date) {
  return within(date, line.startingDate, line.endingDate)
}

/** When a line began to price: its own starting date, else its list's. */
const startOf = (line, list) => String(line.startingDate || list.startingDate || '')

/** Does `a` outrank `b` for the same product and quantity? Later start, then higher list number. */
function outranks (a, b) {
  const [sa, sb] = [startOf(a.line, a.list), startOf(b.line, b.list)]
  if (sa !== sb) return sa > sb
  return String(a.list.number) > String(b.list.number)
}

const minQtyOf = (line) => Number(line.minQty) || 1

/** The winning line per product and minimum quantity, among these lists, on this day. */
function winners (lists, date) {
  const held = new Map()
  for (const list of lists.filter((l) => isInForce(l, date))) {
    for (const line of (list.lines || []).filter((l) => lineInForce(l, date))) {
      const key = JSON.stringify([line.sku, minQtyOf(line)])
      const candidate = { list, line }
      if (!held.has(key) || outranks(candidate, held.get(key))) held.set(key, candidate)
    }
  }
  return held
}

/** One line as it is published: the price or the percent, never both, and where it came from. */
function publishedLine ({ line, list }) {
  const value = line.kind === 'price' ? { price: Number(line.price) } : { percent: Number(line.percent) }
  return { sku: line.sku, kind: line.kind, ...value, minQty: minQtyOf(line), contractNumber: list.number, appliesTo: appliesToOf(list) }
}

const byLine = (a, b) => (a.sku === b.sku ? a.minQty - b.minQty : (a.sku < b.sku ? -1 : 1))

/**
 * One customer's lines in force: its own lists first, then its price group's.
 *
 * @param {object[]} lists stored price lists (any customer or group; the rest are ignored)
 * @param {{ id: string, priceGroup?: string|null }} customer
 * @param {string} date YYYY-MM-DD
 * @returns {object[]} the lines, by product then quantity; empty when none
 */
function partnerPricesInForce (lists, customer, date) {
  const own = winners(lists.filter((l) => appliesToOf(l) === 'customer' && l.partnerId === customer.id), date)
  const group = customer.priceGroup
    ? winners(lists.filter((l) => appliesToOf(l) === 'priceGroup' && l.priceGroup === customer.priceGroup), date)
    : new Map()
  for (const [key, found] of group) if (!own.has(key)) own.set(key, found)
  return [...own.values()].map(publishedLine).sort(byLine)
}

/**
 * Every customer's lines in force.
 *
 * @param {object[]} lists stored price lists
 * @param {object[]} customers `{ id, priceGroup }` each
 * @param {string} date YYYY-MM-DD
 * @returns {Array<{ partnerId: string, lines: object[] }>} customers with at least one line, by id
 */
function pricesInForce (lists, customers, date) {
  return [...customers]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((c) => ({ partnerId: c.id, lines: partnerPricesInForce(lists, c, date) }))
    .filter((item) => item.lines.length > 0)
}

module.exports = { appliesToOf, isInForce, lineInForce, pricesInForce, partnerPricesInForce }
