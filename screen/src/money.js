/*
 * Money, formatted one way.
 *
 * Three screens each built their own: an Intl formatter in productFormat.js, a function
 * in Orders.js, and a bare options object in Partners.js — all three hardcoding dollars.
 * The order document shows money in six places, so it is the third instance and the
 * point at which one helper is worth more than three near-copies.
 *
 * The currency comes from the record that holds it: an order carries its own. Where no
 * record does — a product's list price, a credit limit — the ERP's OWN currency stands in:
 * its company code's, from the website mapped to it (lib/structure.js), handed here once
 * health arrives (App.js). Before that, or for an ERP no mirror has told yet, dollars.
 */
let fallback = 'USD'

/** The ERP's own currency, from health; an empty value leaves the last one standing. */
export function setDefaultCurrency (code) {
  if (typeof code === 'string' && code.trim()) fallback = code.trim().toUpperCase()
}

/** What money with no currency of its own is shown in right now. */
export function defaultCurrency () {
  return fallback
}

/**
 * Options for an Intl formatter, or for a Spectrum NumberField's `formatOptions`.
 *
 * The currency shows as its ISO CODE ("USD 1,850.00"), not a symbol: an ERP serves sales
 * organisations that can each keep their own currency, so the code that names it beats a
 * symbol that hides which one.
 *
 * @param {string} [currency] ISO code from the record
 * @returns {object} `{ style: 'currency', currency, currencyDisplay: 'code' }`
 */
export function moneyOptions (currency) {
  return { style: 'currency', currency: currency || fallback, currencyDisplay: 'code' }
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
