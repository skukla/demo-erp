/*
 * A move on a document: ask the ERP, read the document again, confirm with a toast, tell
 * the shell (whose Home cues and rail counts read the same documents). A refusal is kept as
 * the error the document page shows, in the ERP's own words; the button stays disabled
 * while the ERP is answering, so a move is not sent twice.
 *
 * The document is re-read rather than patched because most moves change several things at
 * once — a posted shipment moves quantities, statuses and the related-documents strip.
 */
import { useState } from 'react'
import { toastSaved } from './toast'

/**
 * @param {Function} reload the document's own reload (useLoad)
 * @param {Function} [onChanged] the shell's refresh, called after a move succeeds
 * @returns {{ act: (call: Function, saved?: string) => Promise<void>, busy: boolean, error: Error|null }}
 */
export function useDocumentAction (reload, onChanged) {
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  async function act (call, saved) {
    setBusy(true)
    try {
      await call()
      setError(null)
      await reload()
      if (saved) toastSaved(saved)
      if (onChanged) onChanged()
    } catch (e) {
      setError(e)
    }
    setBusy(false)
  }
  return { act, busy, error }
}
