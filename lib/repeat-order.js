/*
 * Repeat order (AB-26r; erp-screen-realism §6.4, owner O4 2026-09-24). A canceled order is
 * terminal: it cannot be reinstated, because the customer's web shop cannot un-cancel either
 * and the two would disagree. The way back is a NEW sales order with the same lines, made in
 * the ERP from the canceled one — SAP's "create with reference".
 *
 * The new order is the ERP's own. The web shop never had it, so it carries no customer
 * reference (purchaseOrderByCustomer null) and no line references; a subscriber reads that as
 * "nothing of mine" (contract version 19). It copies what was agreed — customer, sales
 * organization, currency, each line's product, quantity, price and discount, and the total —
 * and NOT the web shop's payment: the shop owns the card gateway, so the repeat is an order on
 * account and goes through the credit check like one.
 *
 * Both orders say so: the new one names the order it repeats (repeatOf), the canceled one the
 * order that repeated it (repeatedAs), each on its timeline. A canceled order repeats once.
 */
const { badRequest } = require('./errors')
const { newOrder } = require('./orders')
const { getPartner } = require('./partners')
const { mustExist, save, stamp, dayOf } = require('./fulfilment')

/**
 * @param {object} cols collections
 * @param {string} number the canceled sales order
 * @param {object} [params] action params (to deliver a credit hold's event)
 * @returns {Promise<object>} the new order
 */
async function repeatOrder (cols, number, params) {
  const original = await mustExist(cols, number)
  if (original.header !== 'canceled') throw badRequest(`Sales order ${number} is not canceled; only a canceled order is repeated.`)
  if (original.repeatedAs) {
    const when = (original.history || []).find((h) => h.status === 'repeated')
    throw badRequest(`This order was repeated as sales order ${original.repeatedAs} on ${dayOf(when ? when.at : original.createdAt)}.`)
  }
  const repeat = await newOrder(cols, {
    reference: null,
    partner: original.partnerId ? await getPartner(cols, original.partnerId) : null,
    lines: original.lines.map((l) => ({ item: l.item, sku: l.sku, qty: l.qty, price: l.price, discount: l.discount, customerLineReference: null, shippedQty: 0, closedQty: 0 })),
    currency: original.currency,
    salesOrg: original.salesOrg,
    salesOrgName: original.salesOrgName,
    total: original.total,
    payment: null,
    repeatOf: number
  }, params)
  await save(cols, { ...original, repeatedAs: repeat.number, history: [...original.history, { status: 'repeated', at: stamp(), order: repeat.number }] })
  return repeat
}

module.exports = { repeatOrder }
