/* A cell's value with a small spinner beside it while its save is under way. */
import React from 'react'
import { ProgressCircle } from '@adobe/react-spectrum'

// Inline, so the cell's own alignment (numbers to the end) still applies.
const ROW = { display: 'inline-flex', alignItems: 'center', gap: 8 }

export default function SavingValue ({ isSaving, children }) {
  if (!isSaving) return children
  return (
    <span style={ROW}>
      {children}
      <ProgressCircle size='S' isIndeterminate aria-label='Saving' />
    </span>
  )
}
