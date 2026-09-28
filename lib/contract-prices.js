/*
 * Prices in force: what customers' contracts price on a day. Pure over the contracts it is
 * handed, so it is tested without a database; the store is lib/contracts.
 *
 * Modelled on Business Central's sales price lists: a Draft list is "not included in price
 * calculations", nor is an Inactive one, and an Active list prices only between its starting
 * and ending dates (both days included). An active contract past its ending date prices
 * nothing, without anyone changing its status.
 *
 * When two contracts in force for one customer price the same SKU at the same minimum
 * quantity, the one with the LATER starting date wins, and on the same starting date the
 * higher contract number (the newer contract). A line at another minimum quantity is a
 * quantity break of its own and is kept beside it.
 */

/** Is this contract pricing on this day? */
function isInForce (contract, date) {
  if (!contract || contract.status !== 'active') return false
  if (contract.startingDate && date < contract.startingDate) return false
  if (contract.endingDate && date > contract.endingDate) return false
  return true
}

/** Does contract `a` outrank contract `b` for the same line? Later start, then higher number. */
function outranks (a, b) {
  if (a.startingDate !== b.startingDate) return String(a.startingDate) > String(b.startingDate)
  return String(a.number) > String(b.number)
}

/** One line as it is published: the price or the percent, never both. */
function publishedLine (line, contract) {
  const value = line.kind === 'price' ? { price: Number(line.price) } : { percent: Number(line.percent) }
  return { sku: line.sku, kind: line.kind, ...value, minQty: Number(line.minQty) || 1, contractNumber: contract.number }
}

const byLine = (a, b) => (a.sku === b.sku ? a.minQty - b.minQty : (a.sku < b.sku ? -1 : 1))

/**
 * Every line in force, per customer.
 *
 * @param {object[]} contracts stored contracts
 * @param {string} date YYYY-MM-DD
 * @returns {Array<{ partnerId: string, lines: object[] }>} customers with at least one line, by id
 */
function pricesInForce (contracts, date) {
  const winners = new Map()
  for (const contract of contracts.filter((c) => isInForce(c, date))) {
    for (const line of contract.lines || []) {
      const key = JSON.stringify([contract.partnerId, line.sku, Number(line.minQty) || 1])
      const held = winners.get(key)
      if (!held || outranks(contract, held.contract)) winners.set(key, { contract, line })
    }
  }
  const byPartner = new Map()
  for (const { contract, line } of winners.values()) {
    if (!byPartner.has(contract.partnerId)) byPartner.set(contract.partnerId, [])
    byPartner.get(contract.partnerId).push(publishedLine(line, contract))
  }
  return [...byPartner.keys()].sort().map((partnerId) => ({ partnerId, lines: byPartner.get(partnerId).sort(byLine) }))
}

/** One customer's lines in force; empty when it has none. */
function partnerPricesInForce (contracts, partnerId, date) {
  const found = pricesInForce(contracts.filter((c) => c.partnerId === partnerId), date)[0]
  return found ? found.lines : []
}

module.exports = { isInForce, pricesInForce, partnerPricesInForce }
