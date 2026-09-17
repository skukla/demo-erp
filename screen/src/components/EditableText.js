/* Text in a table cell that becomes a field on click and saves on Enter or blur. */
import React, { useState } from 'react'
import { ActionButton, TextField } from '@adobe/react-spectrum'

export default function EditableText ({ value, onSave, label = 'Value' }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  if (!editing) {
    return (
      <ActionButton isQuiet onPress={() => { setDraft(value); setEditing(true) }} aria-label={`Edit ${label.toLowerCase()}`}>
        {value}
      </ActionButton>
    )
  }
  async function commit () {
    setEditing(false)
    const next = draft.trim()
    if (next && next !== value) await onSave(next)
  }
  return (
    <TextField aria-label={label} value={draft} onChange={setDraft} width='100%'
      autoFocus onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false) }} />
  )
}
