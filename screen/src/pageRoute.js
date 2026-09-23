/*
 * Which area the address bar is asking for.
 *
 * The open area used to live only in memory, so reloading the browser — which an SC
 * does constantly while preparing a demo — dropped whoever was on Pricing rules back
 * onto the Dashboard. It is in the hash now, which also gives Back and Forward, and
 * makes a link to one area something that can be sent to someone.
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
  const asked = String(hash || '').replace(/^#/, '')
  return keys.includes(asked) ? asked : null
}
