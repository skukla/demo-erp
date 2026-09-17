/*
 * Toasts: a saved record is confirmed with one that closes itself; a failed save
 * stays until it is closed, so its reason can be read.
 */
import { ToastQueue } from '@adobe/react-spectrum'

// Spectrum's shortest allowed time for a toast that closes on its own.
const TOAST_TIMEOUT_MS = 5000

export function toastSaved (message) {
  ToastQueue.positive(message, { timeout: TOAST_TIMEOUT_MS })
}

export function toastFailed (message) {
  ToastQueue.negative(message)
}
