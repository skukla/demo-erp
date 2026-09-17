/*
 * A table edit that shows at once: the row takes the new value and a saving mark,
 * the ERP is asked, and the row then takes the ERP's answer, or its old values back
 * when the save fails. The page does not reload the list.
 */
import { toastFailed, toastSaved } from './toast'

/**
 * @param {object} steps
 * @param {() => void} steps.show put the new value and the saving mark on the row
 * @param {() => Promise<object>} steps.send ask the ERP; answers the saved record
 * @param {(answer: object) => void} steps.settle put the answer on the row, mark cleared
 * @param {() => void} steps.undo put the old values back, mark cleared
 * @param {string} steps.saved what the confirmation says
 */
export async function saveInPlace ({ show, send, settle, undo, saved }) {
  show()
  try {
    settle(await send())
    toastSaved(saved)
  } catch (e) {
    undo()
    toastFailed(`Not saved: ${e.message}`)
  }
}

/** Which cell shows the saving mark for an edit. */
export function savingField (patch) {
  const [field] = Object.keys(patch)
  return field === 'warehouses' ? 'stock' : field
}
