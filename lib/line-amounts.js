/*
 * What a document line is worth. One place, because the sales order, its invoice, a return,
 * every credit memo and the customer's credit exposure must all agree on it.
 *
 * A line's net amount is quantity × price − discount. The discount (contract version 17) is
 * the amount the customer's web shop took off the whole line, a promotion there; the ERP
 * keeps it as sent and does not reprice the order. A line stored before version 17 has none.
 *
 * Requires nothing, so lib/orders and lib/partners (which cannot require each other) both can.
 */

/** Money, to the cent: a sum of qty x price otherwise carries its own float dust. */
const cents = (value) => Math.round(value * 100) / 100

/** The discount a line carries, or 0. */
const discountOf = (line) => Number(line && line.discount) || 0

/** A line's net amount: quantity × price − discount. */
const lineNet = (line) => cents((Number(line.qty) || 0) * (Number(line.price) || 0) - discountOf(line))

/** The net amount of some lines. */
const netOfLines = (lines) => cents((lines || []).reduce((sum, l) => sum + lineNet(l), 0))

/**
 * The part of a line's discount that `qty` units take, when `before` units of the line were
 * taken earlier. Worked out on the running quantity, so the parts of a line taken a few
 * units at a time add up to its discount to the cent, however the cents round.
 *
 * @param {{ qty: number, discount?: number }} line the sales order line
 * @param {number} before units of it taken before
 * @param {number} qty units taken now
 */
function discountShare (line, before, qty) {
  const whole = Number(line.qty) || 0
  if (!whole) return 0
  const upTo = (units) => cents((discountOf(line) * units) / whole)
  return cents(upTo(before + qty) - upTo(before))
}

module.exports = { cents, discountOf, lineNet, netOfLines, discountShare }
