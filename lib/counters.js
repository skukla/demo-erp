/*
 * Monotonic counters. A document number never rewinds, not even across a wipe, so a
 * number a web shop order carries from before a reset can never collide with a new
 * one (decision 8 of the plan). Sales orders, shipments, invoices and contracts each have a
 * counter of their own, starting in ranges of their own (lib/fulfilment FIRST). Settings may
 * move a series forward, never back (checkNext).
 */
const { badRequest } = require('./errors')

/**
 * Where each document type's numbers start: sales orders, shipments, invoices (plan §4.1),
 * contracts, from contract version 13 credit memos and return orders, and from version 14
 * incoming payments.
 */
const STARTS = Object.freeze({ salesOrder: 1000, shipment: 8000000001, invoice: 9000000001, contract: 4000000001, creditMemo: 9500000001, returnOrder: 6000000001, payment: 7000000001 })

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

/** What each series numbers, in words: the refusals name it. */
const SERIES_NAMES = Object.freeze({ salesOrder: 'sales order', shipment: 'shipment', invoice: 'invoice', contract: 'price list', creditMemo: 'credit memo', returnOrder: 'return order', payment: 'payment' })

/** The last ten-digit number. */
const LAST = 9999999999

/**
 * Where each series ends: one below the next series' start, the highest at the last
 * ten-digit number. A number past its end would be read as another document type's.
 */
const ENDS = Object.freeze(Object.fromEntries(Object.entries(STARTS).map(([name, start]) => {
  const above = Object.values(STARTS).filter((s) => s > start)
  return [name, above.length ? Math.min(...above) - 1 : LAST]
})))

/** The number a series hands out next, unreserved. */
async function nextOf (cols, name) {
  const current = await cols.counters.findOne({ _id: name })
  return current ? stored(current) + 1 : STARTS[name]
}

/** @returns {string} a ten-digit document number: every document type alike */
function formatDocumentNumber (value) {
  return String(value).padStart(10, '0')
}

/**
 * The next number of each document type, formatted, WITHOUT reserving it: what the Settings
 * screen's Document numbering card shows. Reading it twice answers the same numbers.
 * @returns {Promise<{ salesOrder: string, shipment: string, invoice: string, contract: string, creditMemo: string, returnOrder: string, payment: string }>}
 */
async function peek (cols) {
  const out = {}
  for (const name of Object.keys(STARTS)) {
    // eslint-disable-next-line no-await-in-loop -- one read per range, in order
    out[name] = formatDocumentNumber(await nextOf(cols, name))
  }
  return out
}

/**
 * The number series, as Settings shows them: each document type with its starting, next
 * and ending number (Business Central's No. Series lines).
 * @returns {Promise<Array<{ type: string, starting: string, next: string, ending: string }>>}
 */
async function numberSeries (cols) {
  const next = await peek(cols)
  return Object.keys(STARTS).map((type) => ({ type, starting: formatDocumentNumber(STARTS[type]), next: next[type], ending: formatDocumentNumber(ENDS[type]) }))
}

/**
 * The next number a series may be moved to: forward only, because a series never rewinds
 * (a number handed out once is never handed out again), and no further than its end.
 * @returns {Promise<number>} the number, checked
 */
async function checkNext (cols, type, value) {
  if (!SERIES_NAMES[type]) throw badRequest(`${type} is not a number series of this ERP.`)
  const wanted = Number(typeof value === 'string' ? value.trim() : value)
  const name = SERIES_NAMES[type]
  if (!Number.isInteger(wanted) || wanted < 1) throw badRequest(`The next ${name} number must be a whole number.`)
  const now = await nextOf(cols, type)
  if (wanted < now) {
    throw badRequest(`A number series never goes back: the next ${name} number is ${formatDocumentNumber(now)}. Enter ${formatDocumentNumber(now)} or higher.`)
  }
  if (wanted > ENDS[type]) throw badRequest(`${name[0].toUpperCase()}${name.slice(1)} numbers end at ${formatDocumentNumber(ENDS[type])}.`)
  return wanted
}

/** Move a series forward to a checked next number (checkNext): the number before it counts as taken. */
async function setNext (cols, type, wanted) {
  if (wanted === await nextOf(cols, type)) return
  await cols.counters.replaceOne({ _id: type }, { _id: type, value: wanted - 1 }, { upsert: true })
}

module.exports = { STARTS, ENDS, SERIES_NAMES, next, peek, numberSeries, checkNext, setNext, formatDocumentNumber }
