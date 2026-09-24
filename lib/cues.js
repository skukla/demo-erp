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
  { key: 'blockedCustomers', label: 'Blocked customers', list: 'partners', filter: 'blocked' },
  { key: 'eventsFailed', label: 'Events not delivered', list: 'events', filter: 'failed' },
  { key: 'eventsPending', label: 'Events waiting', list: 'events', filter: 'pending' }
]

/** Which cue each rail item carries as its count, and which cues add up to it. */
const RAIL_COUNTS = {
  orders: ['toConfirm', 'onHold', 'toShip', 'toInvoice'],
  shipments: ['toPost'],
  partners: ['blockedCustomers'],
  events: ['eventsFailed']
}

module.exports = { CUES, RAIL_COUNTS }
