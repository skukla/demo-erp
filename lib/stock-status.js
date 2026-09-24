/*
 * The three tints of a stock figure. Standalone on purpose: the screen imports it too
 * (the Products list and the product page), and it must not drag the database modules
 * into the browser bundle the way lib/availability would.
 */

/** Below this, an available quantity shows as low stock rather than in stock. */
const LOW_STOCK_THRESHOLD = 10

/**
 * @param {number} available on hand less committed
 * @returns {'out'|'low'|'in'}
 */
function stockStatus (available) {
  if (!(available > 0)) return 'out'
  return available < LOW_STOCK_THRESHOLD ? 'low' : 'in'
}

module.exports = { LOW_STOCK_THRESHOLD, stockStatus }
