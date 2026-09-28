/*
 * The words a person reads are American English. One value the API carries is British and
 * stays that way, because another program sends and compares it: the reason "Cancelled in
 * Commerce" (the integration sends it; contract/erp-contract.json pins it). This is where it
 * is given the word shown instead. (The overall status word is "Canceled" in the API itself,
 * owner 2026-09-28.)
 */
const SHOWN = {
  'Cancelled in Commerce': 'Canceled in Commerce'
}

/** The word to show for a value the API returns: its American form, or the value itself. */
export function displayWord (value) {
  return Object.prototype.hasOwnProperty.call(SHOWN, value) ? SHOWN[value] : value
}
