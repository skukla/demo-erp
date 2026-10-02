/*
 * Monotonic counters. A document number never rewinds, not even across a wipe, so a
 * number a Commerce order carries from before a reset can never collide with a new
 * one (decision 8 of the plan). Sales orders, shipments, invoices and contracts each have a
 * counter of their own, starting in ranges of their own (lib/fulfilment FIRST).
 */

/**
 * Where each document type's numbers start: sales orders, shipments, invoices (plan §4.1),
 * contracts, and, from contract version 13, credit memos and return orders.
 */
const STARTS = Object.freeze({ salesOrder: 1000, shipment: 8000000001, invoice: 9000000001, contract: 4000000001, creditMemo: 9500000001, returnOrder: 6000000001 })

/**
 * A counter's stored value as a number. App Builder Database hands a value past 32 bits
 * (every shipment and invoice number) back as a BSON Long, and `Long + 1` joined them as
 * text: the second shipment on Bodea came out as 80000000011 (2026-09-27).
 *
 * Only that join ever stored text, so text is repaired here: its first ten digits are the
 * last number taken correctly, and each character the join added is one more number taken.
 * The next count writes a plain number again.
 */
function stored (counter) {
  const { value } = counter
  if (typeof value === 'string' && value.length > 10) {
    return Number(value.slice(0, 10)) + (value.length - 10)
  }
  return Number(value)
}

/**
 * @param {object} cols collections
 * @param {string} name counter name, e.g. 'salesOrder'
 * @param {number} [start] first value when the counter does not exist
 * @returns {Promise<number>} the next value, reserved
 */
async function next (cols, name, start = 1000) {
  const current = await cols.counters.findOne({ _id: name })
  const value = current ? stored(current) + 1 : start
  await cols.counters.replaceOne({ _id: name }, { _id: name, value }, { upsert: true })
  return value
}

/** @returns {string} a ten-digit document number: every document type alike */
function formatDocumentNumber (value) {
  return String(value).padStart(10, '0')
}

/**
 * The next number of each document type, formatted, WITHOUT reserving it: what the Settings
 * screen's Document numbering card shows. Reading it twice answers the same numbers.
 * @returns {Promise<{ salesOrder: string, shipment: string, invoice: string, contract: string, creditMemo: string, returnOrder: string }>}
 */
async function peek (cols) {
  const out = {}
  for (const [name, start] of Object.entries(STARTS)) {
    // eslint-disable-next-line no-await-in-loop -- one read per range, in order
    const current = await cols.counters.findOne({ _id: name })
    out[name] = formatDocumentNumber(current ? stored(current) + 1 : start)
  }
  return out
}

module.exports = { STARTS, next, peek, formatDocumentNumber }
