/*
 * Money, formatted one way.
 *
 * Three screens each built their own: an Intl formatter in productFormat.js, a function
 * in Orders.js, and a bare options object in Partners.js — all three hardcoding dollars.
 * The order document shows money in six places, so it is the third instance and the
 * point at which one helper is worth more than three near-copies.
 *
 * The currency comes from the record that holds it: an order carries its own. Where no
 * record does — a product's list price, a credit limit — the ERP has no currency of its
 * own yet, and these fall back to dollars. That fallback is a known gap, not a decision:
 * a euro demo shows dollars on those screens.
 */
const FALLBACK = 'USD'

/**
 * Options for an Intl formatter, or for a Spectrum NumberField's `formatOptions`.
 *
 * @param {string} [currency] ISO code from the record
 * @returns {object} `{ style: 'currency', currency }`
 */
export function moneyOptions (currency) {
  return { style: 'currency', currency: currency || FALLBACK }
}

/**
 * @param {number|string|null|undefined} amount
 * @param {string} [currency] ISO code from the record
 * @returns {string} the amount as money, and zero for anything unreadable
 */
export function money (amount, currency) {
  const value = Number(amount)
  return new Intl.NumberFormat(undefined, moneyOptions(currency)).format(Number.isFinite(value) ? value : 0)
}
