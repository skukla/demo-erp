/*
 * The work cues Home shows and the rail counts, shared by lib/work (which counts them)
 * and the screen (which draws them). Pure data with no dependencies, so the browser
 * bundle can import it as the actions require it.
 */

/** In the order the demo walks them; `list` and `filter` say which filtered list a cue opens. */
const CUES = [
  { key: 'toConfirm', label: 'Orders to confirm', list: 'orders', filter: 'toConfirm' },
  { key: 'onHold', label: 'Orders on credit hold', list: 'orders', filter: 'onHold' },
  { key: 'toShip', label: 'Orders to ship', list: 'orders', filter: 'toShip' },
  { key: 'toPost', label: 'Shipments to post', list: 'shipments', filter: 'open' },
  { key: 'toInvoice', label: 'Orders to invoice', list: 'orders', filter: 'toInvoice' },
  { key: 'invoicesToCollect', label: 'Invoices to collect', list: 'invoices', filter: 'toCollect' },
  { key: 'returnsToReceive', label: 'Returns to receive', list: 'returns', filter: 'open' },
  { key: 'returnsToCredit', label: 'Returns to credit', list: 'returns', filter: 'received' },
  { key: 'blockedCustomers', label: 'Blocked customers', list: 'partners', filter: 'blocked' },
  { key: 'eventsFailed', label: 'Messages not sent', list: 'events', filter: 'failed' },
  { key: 'eventsPending', label: 'Messages waiting', list: 'events', filter: 'pending' }
]

/**
 * Which of an order's abilities (lib/orders `can`) put it under each order cue: any one of them
 * counts it. One rule for Home's count (lib/work) and the Orders list's filter (the screen), so
 * the two cannot disagree. An order whose goods wait on a shipment to post is still to ship
 * (owner 2026-10-09): Post shipment is its next step, as Create shipment was before it.
 */
const ORDER_CUE_ABILITIES = {
  toConfirm: ['confirm'],
  onHold: ['release'],
  toShip: ['ship', 'post'],
  toInvoice: ['invoice']
}

/** Which cue each rail item carries as its count, and which cues add up to it. */
const RAIL_COUNTS = {
  orders: ['toConfirm', 'onHold', 'toShip', 'toInvoice'],
  shipments: ['toPost'],
  invoices: ['invoicesToCollect'],
  returns: ['returnsToReceive', 'returnsToCredit'],
  partners: ['blockedCustomers'],
  events: ['eventsFailed']
}

module.exports = { CUES, RAIL_COUNTS, ORDER_CUE_ABILITIES }
