/*
 * The maintenance window (AB-16j, owner 2026-09-28). A real ERP's API answers "unavailable"
 * while the system is in maintenance; this one does too, so the integration's handling of an
 * ERP that is down (orders wait, Partially Held, Re-send) can be shown.
 *
 * The window is one stored end time, `maintenanceUntil`. It ends by itself: a time that has
 * passed counts as off, so a window someone forgot to end cannot break the next demo, and no
 * timer or alarm is needed to switch it back.
 */
const { badRequest } = require('./errors')
const { SETTINGS_ID, getSettings } = require('./settings')

const DEFAULT_MINUTES = 30
const MAX_MINUTES = 24 * 60

/** "14:30 UTC": the end, in the ERP's own time zone, as its people read a clock. */
function clockTime (iso, timeZone = 'UTC') {
  return new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone, timeZoneName: 'short' }).format(new Date(iso))
}

/**
 * @param {object} settings the ERP's settings record
 * @param {Date} [now]
 * @returns {{ until: string, message: string } | null} the window in force, or null when off
 */
function maintenanceOf (settings, now = new Date()) {
  const until = settings && settings.maintenanceUntil
  if (!until || Date.parse(until) <= now.getTime()) return null
  return { until, message: `${settings.displayName} is in maintenance until ${clockTime(until, settings.timeZone)}.` }
}

/** Whole minutes from 1 to a day; absent means the default window. */
function minutesOf (value) {
  if (value === undefined) return DEFAULT_MINUTES
  if (!Number.isInteger(value) || value < 1 || value > MAX_MINUTES) {
    throw badRequest(`A maintenance window is 1 to ${MAX_MINUTES} minutes.`)
  }
  return value
}

async function writeUntil (cols, defaultName, until) {
  const current = await getSettings(cols, defaultName)
  const next = { ...current, maintenanceUntil: until }
  await cols.settings.replaceOne({ _id: SETTINGS_ID }, next, { upsert: true })
  return maintenanceOf(next)
}

/** Start (or restart) the window, `minutes` from now. */
function startMaintenance (cols, minutes, defaultName) {
  const until = new Date(Date.now() + minutesOf(minutes) * 60 * 1000).toISOString()
  return writeUntil(cols, defaultName, until)
}

/** End the window now. */
function endMaintenance (cols, defaultName) {
  return writeUntil(cols, defaultName, null)
}

module.exports = { DEFAULT_MINUTES, MAX_MINUTES, maintenanceOf, startMaintenance, endMaintenance }
