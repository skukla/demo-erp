/* A number in a table cell that becomes a field on click and saves on Enter or blur. */
import React, { useState } from 'react'
import { NumberField, ActionButton } from '@adobe/react-spectrum'

export default function EditableNumber ({ value, onSave, formatOptions, step = 1, minValue = 0 }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  if (!editing) {
    return (
      <ActionButton isQuiet onPress={() => { setDraft(value); setEditing(true) }} aria-label='Edit'>
        {formatOptions ? new Intl.NumberFormat(undefined, formatOptions).format(value) : String(value)}
      </ActionButton>
    )
  }
  async function commit () {
    setEditing(false)
    if (draft !== value && Number.isFinite(draft)) await onSave(draft)
  }
  return (
    <NumberField aria-label='Value' value={draft} onChange={setDraft} step={step} minValue={minValue} width='size-1600'
      autoFocus onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }} />
  )
}
