/*
 * The times the screen shows, in words a person reads.
 *
 * The stamps are stored as ISO strings and were printed raw:
 * "Last sync: 2026-09-17T18:33:23.836Z". Recent ones now read as an age ("4
 * minutes ago"), which is what someone rehearsing a demo actually wants to
 * know, and older ones as a plain date and time in the viewer's own zone.
 */

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function ago (ms) {
  if (ms < MINUTE) return 'just now'
  if (ms < HOUR) {
    const minutes = Math.floor(ms / MINUTE)
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  }
  const hours = Math.floor(ms / HOUR)
  return `${hours} hour${hours === 1 ? '' : 's'} ago`
}

/**
 * @param {string|null|undefined} iso the stored stamp
 * @param {object} [options] `now` (ms, for tests), `locale`, `timeZone`
 * @returns {string} "never", "just now", "4 minutes ago", or "17 Sep 2026, 18:33"
 */
export function formatStamp (iso, options = {}) {
  if (!iso) return 'never'
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return 'never'
  const { now = Date.now(), locale = undefined, timeZone = undefined } = options
  const age = now - at
  // A stamp in the future is a clock disagreement, not an age; show the date.
  if (age >= 0 && age < DAY) return ago(age)
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone
  }).format(new Date(at))
}
