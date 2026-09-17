/* Text in a table cell that becomes a field on click and saves on Enter or blur. */
import React, { useState } from 'react'
import { ActionButton, Text, TextField } from '@adobe/react-spectrum'
import SavingValue from './SavingValue'

// A long name wraps instead of being cut off: Spectrum keeps a button's label on one line.
const WRAPPING_BUTTON = { height: 'auto', minHeight: 32, paddingBlock: 4 }
const WRAPPING_LABEL = { whiteSpace: 'normal', overflow: 'visible', textAlign: 'start' }

export default function EditableText ({ value, onSave, label = 'Value', isSaving = false }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  if (!editing) {
    return (
      <SavingValue isSaving={isSaving}>
        <ActionButton isQuiet UNSAFE_style={WRAPPING_BUTTON} onPress={() => { setDraft(value); setEditing(true) }} aria-label={`Edit ${label.toLowerCase()}`}>
          <Text UNSAFE_style={WRAPPING_LABEL}>{value}</Text>
        </ActionButton>
      </SavingValue>
    )
  }
  function commit () {
    setEditing(false)
    const next = draft.trim()
    if (next && next !== value) onSave(next)
  }
  return (
    <TextField aria-label={label} value={draft} onChange={setDraft} width='100%'
      autoFocus onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }} />
  )
}
