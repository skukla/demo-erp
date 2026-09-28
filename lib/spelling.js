/*
 * Values an ERP stored in British English before contract version 10, and the American
 * value each reads as now (owner, 2026-09-28: the audience is American, and so is the API).
 * Only STORED records are read through this. On the wire the old values are refused: the
 * ERP and the integration are deployed together, and nothing is kept accepted-but-old.
 */
const RENAMED = {
  cancelled: 'canceled',
  'order.cancelled': 'order.canceled',
  'Cancelled in Commerce': 'Canceled in Commerce'
}

/** A stored value as it reads today: its American form, or the value itself. */
function current (value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(RENAMED, value) ? RENAMED[value] : value
}

/** The record with each named key it HAS read through `current`; a missing key stays missing. */
function withCurrent (record, keys) {
  const next = { ...record }
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(next, key)) next[key] = current(next[key])
  }
  return next
}

module.exports = { current, withCurrent }
