/*
 * Which area the address bar is asking for, and what it asks of that area.
 *
 * The open area used to live only in memory, so reloading the browser — which an SC
 * does constantly while preparing a demo — dropped whoever was on Pricing rules back
 * onto Home. It is in the hash now, which also gives Back and Forward, and makes a link
 * to one area something that can be sent to someone.
 *
 * Since Home became a work list the hash also carries a QUERY: `#orders?work=toShip` is
 * the Sales Orders list filtered to what a cue counted, `#orders?open=0000001003` the list
 * with that document opened — which is how a search result, a recent document and a
 * journal line all reach a document from anywhere.
 *
 * The hash is safe to use alongside the screen key: `takeScreenKey` strips `?key=` from
 * the address and keeps the hash when it rewrites (key.js).
 */

/**
 * @param {string} hash `window.location.hash`, with or without its leading #
 * @param {string[]} keys the areas that exist
 * @returns {string|null} the area asked for, or null for an empty or unknown hash
 */
export function pageFromHash (hash, keys) {
  return routeFromHash(hash, keys).page
}

/**
 * @param {string} hash as above
 * @param {string[]} keys the areas that exist
 * @returns {{ page: string|null, query: Record<string, string> }} the area and its query,
 *   `{ page: null, query: {} }` for an empty or unknown hash
 */
export function routeFromHash (hash, keys) {
  const asked = String(hash || '').replace(/^#/, '')
  const at = asked.indexOf('?')
  const page = at >= 0 ? asked.slice(0, at) : asked
  if (!keys.includes(page)) return { page: null, query: {} }
  const query = at >= 0 ? Object.fromEntries(new URLSearchParams(asked.slice(at + 1))) : {}
  return { page, query }
}

/** The hash for an area with a query: `orders?work=toShip`, or just `orders`. */
export function hashFor (page, query = {}) {
  const params = new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ''))
  const text = params.toString()
  return text ? `${page}?${text}` : page
}
