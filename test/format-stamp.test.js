/*
 * The times the Settings screen shows, from the ERP's ISO stamps.
 *
 * The month reads "Sept" rather than "Sep": that is what en-GB gives, and the
 * expectations follow the formatter rather than the other way round.
 */
const { test } = require('node:test')
const assert = require('node:assert/strict')

async function load () {
  return import('../screen/src/formatStamp.js')
}

const NOW = Date.parse('2026-09-17T19:05:00.000Z')
const opts = (extra = {}) => ({ now: NOW, locale: 'en-GB', timeZone: 'UTC', ...extra })

test('a missing or unreadable stamp reads never', async () => {
  const { formatStamp } = await load()
  assert.equal(formatStamp(null, opts()), 'never')
  assert.equal(formatStamp(undefined, opts()), 'never')
  assert.equal(formatStamp('', opts()), 'never')
  assert.equal(formatStamp('not a date', opts()), 'never')
})

test('a recent stamp reads as an age', async () => {
  const { formatStamp } = await load()
  assert.equal(formatStamp('2026-09-17T19:04:30.000Z', opts()), 'just now')
  assert.equal(formatStamp('2026-09-17T19:04:00.000Z', opts()), '1 minute ago')
  assert.equal(formatStamp('2026-09-17T18:33:00.000Z', opts()), '32 minutes ago')
  assert.equal(formatStamp('2026-09-17T18:05:00.000Z', opts()), '1 hour ago')
  assert.equal(formatStamp('2026-09-17T04:05:00.000Z', opts()), '15 hours ago')
})

test('anything older than a day reads as a date and time, in the viewer’s zone', async () => {
  const { formatStamp } = await load()
  assert.equal(formatStamp('2026-09-14T18:33:00.000Z', opts()), '14 Sept 2026, 18:33')
  // Same instant, a zone ahead: the viewer sees their own clock.
  assert.equal(formatStamp('2026-09-14T18:33:00.000Z', opts({ timeZone: 'Europe/Berlin' })), '14 Sept 2026, 20:33')
})

test('a stamp in the future shows its date rather than a negative age', async () => {
  const { formatStamp } = await load()
  assert.equal(formatStamp('2026-09-18T09:00:00.000Z', opts()), '18 Sept 2026, 09:00')
})

test('a document date reads as a day, with no time', async () => {
  const { formatDate } = await load()
  assert.equal(formatDate('2026-09-17T18:33:23.836Z', { locale: 'en-GB', timeZone: 'UTC' }), '17 Sept 2026')
  assert.equal(formatDate('2026-01-02T00:00:00.000Z', { locale: 'en-GB', timeZone: 'UTC' }), '2 Jan 2026')
})

test('a missing or unreadable document date reads as a dash', async () => {
  const { formatDate } = await load()
  assert.equal(formatDate(null), '—')
  assert.equal(formatDate(undefined), '—')
  assert.equal(formatDate(''), '—')
  assert.equal(formatDate('not a date'), '—')
})
