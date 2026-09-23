/*
 * What a wipe removed, in one line.
 *
 * `POST admin/wipe` answers `{ wiped: { <collection>: <documents removed> } }`,
 * and the Settings screen used to throw that away: the only sign a wipe had
 * happened was the "Last wipe" timestamp changing. Sync says what it did, so a
 * wipe should too — the two sit next to each other.
 *
 * Collections with nothing in them are left out: "0 pricing conditions" is
 * noise, and an ERP that was already empty says so in its own sentence.
 */

/** Singular and plural for each collection a wipe clears. */
const LABELS = {
  products: ['product', 'products'],
  businessPartners: ['customer', 'customers'],
  pricingConditions: ['pricing condition', 'pricing conditions'],
  salesOrders: ['sales order', 'sales orders'],
  events: ['event', 'events']
}

/** "3 products", "1 customer", or the raw name for a collection we have no words for. */
function count (name, n) {
  const words = LABELS[name]
  return `${n} ${words ? words[n === 1 ? 0 : 1] : name}`
}

/** "a", "a and b", "a, b and c". */
function list (parts) {
  if (parts.length < 2) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/**
 * @param {Record<string, number>} wiped documents removed per collection
 * @returns {string} one sentence for the screen
 */
export function wipeSummary (wiped) {
  const parts = Object.entries(wiped || {})
    .filter(([, n]) => Number(n) > 0)
    .map(([name, n]) => count(name, Number(n)))
  if (parts.length === 0) return 'Nothing to wipe: the ERP was already empty.'
  return `Wiped ${list(parts)}. The order numbering and the settings stay.`
}
