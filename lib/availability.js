/*
 * The product as a master record (screen-realism plan slice 6, §3.7): what an ERP calls
 * committed and available. Committed is the quantity ordered and not yet shipped on
 * orders that still stand — SAP's "confirmed quantity" on open sales documents; Business
 * Central's "Qty. on Sales Order". Available is on hand less committed; it goes below
 * zero when more is sold than is on the shelf, and the screen says so rather than
 * clamping it.
 *
 * Nothing here is stored. Every figure is read off the order lines lib/fulfilment already
 * keeps (`qty`, `shippedQty`, `closedQty`), so a product cannot say "12 committed" while
 * its orders say otherwise — the same rule Home's cues follow (lib/work).
 */
const { openQty } = require('./orders')
const { LOW_STOCK_THRESHOLD, stockStatus } = require('./stock-status')

/** An order whose open quantities still claim stock: not canceled, not yet invoiced. */
function commitsStock (order) {
  return order.header !== 'canceled' && !order.invoice
}

/**
 * @param {object[]} orders as lib/orders listOrders answers them
 * @returns {Map<string, number>} committed quantity by SKU; a SKU with nothing open is absent
 */
function committedBySku (orders) {
  const committed = new Map()
  for (const order of orders) {
    if (!commitsStock(order)) continue
    for (const line of order.lines || []) {
      const open = openQty(line)
      if (open > 0) committed.set(line.sku, (committed.get(line.sku) || 0) + open)
    }
  }
  return committed
}

/**
 * The orders that hold a product: each once, with the quantity still open on it, newest
 * first. A parent asks for its variants' SKUs together.
 *
 * @param {object[]} orders
 * @param {string|string[]} skus
 * @returns {{ number: string, partnerId: string|null, qty: number, status: string, createdAt: string }[]}
 */
function openOrdersFor (orders, skus) {
  const wanted = new Set(Array.isArray(skus) ? skus : [skus])
  const rows = []
  for (const order of orders) {
    if (!commitsStock(order)) continue
    const qty = (order.lines || []).filter((l) => wanted.has(l.sku)).reduce((sum, l) => sum + openQty(l), 0)
    if (qty > 0) rows.push({ number: order.number, partnerId: order.partnerId || null, qty, status: order.status, createdAt: order.createdAt })
  }
  // Numbers only ever grow, so the highest is the newest — and two created in the same
  // millisecond still sort the same way every time.
  return rows.sort((a, b) => (a.number < b.number ? 1 : -1))
}

/**
 * One product with `committed` and `available`. A configurable parent carries the sum
 * over its `variants` (which it has when read alone; the list form is handled by
 * withAvailabilityAll), each variant decorated too.
 */
function withAvailability (product, committed) {
  if (product.type === 'configurable') {
    const variants = Array.isArray(product.variants) ? product.variants.map((v) => withAvailability(v, committed)) : null
    const total = variants ? variants.reduce((sum, v) => sum + v.committed, 0) : 0
    return { ...product, ...(variants ? { variants } : {}), committed: total, available: (product.stock || 0) - total }
  }
  const qty = committed.get(product.sku) || 0
  return { ...product, committed: qty, available: (product.stock || 0) - qty }
}

/**
 * The list form: every row decorated; a parent's figures summed from the variant rows
 * in the same list (lib/products listProducts lists variants beside their parent).
 */
function withAvailabilityAll (rows, committed) {
  const decorated = rows.map((p) => (p.type === 'configurable' ? p : withAvailability(p, committed)))
  const byParent = new Map()
  for (const p of decorated) {
    if (p.parentSku) byParent.set(p.parentSku, (byParent.get(p.parentSku) || 0) + p.committed)
  }
  return decorated.map((p) => {
    if (p.type !== 'configurable') return p
    const total = byParent.get(p.sku) || 0
    return { ...p, committed: total, available: (p.stock || 0) - total }
  })
}

/*
 * Available-to-promise (AB-19): whether the ERP can promise a quantity of a SKU, and by when.
 * "Can I have 500 by Friday" is the ERP question a synced stock number cannot answer — it needs
 * a promise DATE. What is available now (on hand less committed) ships today; a shortfall ships
 * after the product's lead time, the replenishment a real ERP tracks (SAP's ATP over a lead
 * time; Business Central's "Expected Receipt"). `available` can be negative (oversold); a
 * request within it still promises today.
 */
const DEFAULT_LEAD_TIME_DAYS = 5

/** A Date plus whole days, as YYYY-MM-DD (UTC). Calendar days: a demo lead time, not a work calendar. */
function dayAfter (date, days) {
  const d = new Date(date.getTime())
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * The ERP's promise for one requested line.
 * @param {object} args
 * @param {string} args.sku
 * @param {number} args.available on hand less committed (may be negative)
 * @param {number} args.requested the quantity asked for
 * @param {number} [args.leadTimeDays] the product's lead time; the default when absent or not positive
 * @param {Date} [args.today] the day the promise is made from
 * @returns {{ sku, requested, availableNow, canPromiseNow, promiseDate, leadTimeDays }}
 */
function promiseLine ({ sku, available, requested, leadTimeDays, today = new Date() }) {
  const asked = Math.max(1, Math.trunc(Number(requested) || 1))
  const availableNow = Math.trunc(Number(available) || 0)
  const lead = Number(leadTimeDays) > 0 ? Math.trunc(Number(leadTimeDays)) : DEFAULT_LEAD_TIME_DAYS
  const canPromiseNow = availableNow >= asked
  const promiseDate = canPromiseNow ? dayAfter(today, 0) : dayAfter(today, lead)
  return { sku, requested: asked, availableNow, canPromiseNow, promiseDate, leadTimeDays: lead }
}

module.exports = { LOW_STOCK_THRESHOLD, stockStatus, commitsStock, committedBySku, openOrdersFor, withAvailability, withAvailabilityAll, DEFAULT_LEAD_TIME_DAYS, promiseLine }
