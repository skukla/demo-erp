/*
 * The words a person reads are American English. A few values the API returns are
 * British and stay that way, because code compares them: the overall status word
 * "Cancelled" (lib/orders overallStatus, the Sales Orders stage filter's key) and the
 * reason "Cancelled in Commerce" (the integration sends it; contract/erp-contract.json
 * pins it). This is where each is given the word shown instead.
 */
const SHOWN = {
  Cancelled: 'Canceled',
  'Cancelled in Commerce': 'Canceled in Commerce'
}

/** The word to show for a value the API returns: its American form, or the value itself. */
export function displayWord (value) {
  return Object.prototype.hasOwnProperty.call(SHOWN, value) ? SHOWN[value] : value
}
