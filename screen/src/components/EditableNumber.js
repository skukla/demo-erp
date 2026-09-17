/*
 * A number in a table cell that becomes a field on click and saves on Enter or blur.
 *
 * Spectrum's NumberField reports a value only when it is committed (Enter or blur),
 * not per keystroke, so the save happens in onChange. Closing on blur alone is safe:
 * React applies the close after the event, and the field commits during it.
 */
import React, { useState } from 'react'
import { NumberField, ActionButton } from '@adobe/react-spectrum'
import SavingValue from './SavingValue'

export default function EditableNumber ({ value, onSave, formatOptions, step = 1, minValue = 0, label = 'Value', isSaving = false }) {
  const [editing, setEditing] = useState(false)
  if (!editing) {
    return (
      <SavingValue isSaving={isSaving}>
        <ActionButton isQuiet onPress={() => setEditing(true)} aria-label={`Edit ${label.toLowerCase()}`}>
          {formatOptions ? new Intl.NumberFormat(undefined, formatOptions).format(value) : String(value)}
        </ActionButton>
      </SavingValue>
    )
  }
  function commit (next) {
    setEditing(false)
    if (next !== value && Number.isFinite(next)) onSave(next)
  }
  return (
    <NumberField aria-label={label} defaultValue={value} onChange={commit} step={step} minValue={minValue}
      formatOptions={formatOptions} width='size-1600' autoFocus
      onBlur={() => setEditing(false)} onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false) }} />
  )
}
