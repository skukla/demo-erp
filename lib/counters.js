/*
 * Monotonic counters. A document number never rewinds, not even across a wipe, so a
 * number a Commerce order carries from before a reset can never collide with a new
 * one (decision 8 of the plan). Sales orders, shipments and invoices each have a
 * counter of their own, starting in ranges of their own (lib/fulfilment FIRST).
 */

/**
 * @param {object} cols collections
 * @param {string} name counter name, e.g. 'salesOrder'
 * @param {number} [start] first value when the counter does not exist
 * @returns {Promise<number>} the next value, reserved
 */
async function next (cols, name, start = 1000) {
  const current = await cols.counters.findOne({ _id: name })
  const value = current ? current.value + 1 : start
  await cols.counters.replaceOne({ _id: name }, { _id: name, value }, { upsert: true })
  return value
}

/** @returns {string} a ten-digit document number: sales order, shipment, invoice alike */
function formatDocumentNumber (value) {
  return String(value).padStart(10, '0')
}

module.exports = { next, formatDocumentNumber }
