/*
 * Wipe and import: the ERP's half of a reset. Counters survive a wipe on purpose
 * (see counters.js). The integration orchestrates the rest (plan decision 11).
 *
 * Remove orders (contract version 23): the ERP's half of a web shop closing SOME of its orders,
 * a store wiped for the next demo while the ERP serves others. The ERP is transient, so it keeps
 * nothing of those orders and everything else.
 */
const { COLLECTIONS, findAll } = require('./db')
const { findOrderByReference, upgradeOrderRecord } = require('./legacy')
const { stamp } = require('./settings')

const WIPED = COLLECTIONS.filter((name) => name !== 'counters' && name !== 'settings')

/** @returns {Promise<Record<string, number>>} documents removed per collection */
async function wipe (cols) {
  const removed = {}
  for (const name of WIPED) {
    const result = await cols[name].deleteMany({})
    removed[name] = (result && result.deletedCount) || 0
  }
  // `lastImportAt` stays: the ERP WAS filled, and blanking it made the screen say
  // "never" beside the wipe time. The two stamps together tell the truth — filled,
  // then wiped.
  await stamp(cols, { lastWipeAt: new Date().toISOString() })
  return removed
}

/** Journal entries are read a page at a time: a journal outgrows one read. */
const PAGE = 500

/** Whether a journal entry belongs to the sales order: its event's data, or what it received. */
const entryOf = (numbers) => (entry) =>
  (entry.data && numbers.has(String(entry.data.SalesOrder))) ||
  (entry.value && numbers.has(String(entry.value.number)))

/** Delete the journal entries of these sales orders; answers how many. */
async function removeEntries (cols, numbers) {
  const ids = []
  for (let skip = 0; ; skip += PAGE) {
    const page = await cols.events.find({}, { sort: { _id: 1 }, skip, limit: PAGE }).toArray()
    ids.push(...page.filter(entryOf(numbers)).map((entry) => entry._id))
    if (page.length < PAGE) break
  }
  for (const _id of ids) await cols.events.deleteMany({ _id })
  return ids.length
}

/** The sales orders the references name, and every repeat the ERP made of one, transitively. */
async function ordersToRemove (cols, references) {
  const found = []
  const notFound = []
  for (const reference of references) {
    const stored = await findOrderByReference(cols.salesOrders, reference)
    if (stored) found.push(stored)
    else notFound.push(reference)
  }
  const orders = [...found]
  for (let i = 0; i < orders.length; i += 1) {
    orders.push(...await findAll(cols.salesOrders, { repeatOf: orders[i].number }))
  }
  return { orders: orders.map(upgradeOrderRecord), removed: found.map((o) => upgradeOrderRecord(o).purchaseOrderByCustomer), notFound }
}

/** Remove one sales order and what points at it; adds to the counts. */
async function removeOrder (cols, order, removed) {
  const returns = await findAll(cols.returnOrders, { orderNumber: order.number }, { limit: 10000 })
  removed.shipments += (order.shipments || []).length
  removed.invoices += order.invoice ? 1 : 0
  removed.creditMemos += (order.creditMemos || []).length + returns.filter((r) => r.creditMemo).length
  removed.returnOrders += (await cols.returnOrders.deleteMany({ orderNumber: order.number })).deletedCount || 0
  removed.payments += (await cols.payments.deleteMany({ orderNumber: order.number })).deletedCount || 0
  removed.salesOrders += (await cols.salesOrders.deleteMany({ _id: order._id })).deletedCount || 0
}

/**
 * Remove the sales orders the web shop's references name (`purchaseOrderByCustomer`), each with
 * its shipments, invoice and credit memos, its return orders, its payments, a repeat the ERP made
 * of it, and its journal entries. Counters stay, so no number is given out twice. A reference no
 * order has is named back, not refused: removing twice removes nothing the second time.
 *
 * @param {object} cols collections
 * @param {string[]} references the web shop's order numbers
 * @returns {Promise<{ removed: Record<string, number>, references: { removed: string[], notFound: string[] } }>}
 */
async function removeOrders (cols, references) {
  const { orders, removed: named, notFound } = await ordersToRemove(cols, [...new Set(references)])
  const removed = { salesOrders: 0, shipments: 0, invoices: 0, creditMemos: 0, returnOrders: 0, payments: 0, events: 0 }
  for (const order of orders) await removeOrder(cols, order, removed)
  removed.events = await removeEntries(cols, new Set(orders.map((o) => String(o.number))))
  return { removed, references: { removed: named, notFound } }
}

module.exports = { WIPED, wipe, removeOrders }
