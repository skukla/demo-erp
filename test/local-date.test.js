/*
 * The ERP prices on its own local date (AB-26z follow-up). A real ERP decides which price
 * lines are in force by the company's local date, not UTC: a line starting 1 January is in
 * force from local midnight. The ERP has one time zone (settings.timeZone, an IANA name),
 * default UTC, so nothing changes until it is set.
 */
const { test, beforeEach } = require('node:test')
const assert = require('node:assert/strict')
const { memoryCollections } = require('./helpers/memory-db')
const { today } = require('../lib/pricing')
const { getSettings, updateSettings } = require('../lib/settings')

// 31 Dec 2026, 23:30 in New York = 1 Jan 2027, 04:30 UTC.
const NEW_YEARS_EVE_NY = new Date('2027-01-01T04:30:00Z')

let cols
beforeEach(() => { cols = memoryCollections() })

test('today is the UTC date when no time zone is given', () => {
  assert.equal(today(undefined, NEW_YEARS_EVE_NY), '2027-01-01')
})

test("today is the ERP's local date in its time zone", () => {
  assert.equal(today('America/New_York', NEW_YEARS_EVE_NY), '2026-12-31')
  assert.equal(today('Asia/Tokyo', new Date('2026-12-31T16:00:00Z')), '2027-01-01')
})

test('a fresh ERP keeps UTC', async () => {
  assert.equal((await getSettings(cols)).timeZone, 'UTC')
})

test('the time zone is set by name, and a name that is not a time zone is refused', async () => {
  await getSettings(cols, 'Northwind ERP')
  assert.equal((await updateSettings(cols, { timeZone: 'America/Chicago' })).timeZone, 'America/Chicago')
  await assert.rejects(updateSettings(cols, { timeZone: 'Mars/Olympus' }), /not a time zone/)
  assert.equal((await getSettings(cols)).timeZone, 'America/Chicago')
})
