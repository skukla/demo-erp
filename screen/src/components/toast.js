/* The confirmation after a record is saved: a Spectrum toast that closes itself. */
import { ToastQueue } from '@adobe/react-spectrum'

// Spectrum's shortest allowed time for a toast that closes on its own.
const TOAST_TIMEOUT_MS = 5000

export function toastSaved (message) {
  ToastQueue.positive(message, { timeout: TOAST_TIMEOUT_MS })
}
