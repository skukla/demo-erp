/*
 * The Edit / Done switch for a table, as SAP does it: a table reads as display
 * until someone chooses Edit, and choosing Done returns it to display.
 */
import React from 'react'
import { ActionButton, Text } from '@adobe/react-spectrum'
import Edit from '@spectrum-icons/workflow/Edit'
import Checkmark from '@spectrum-icons/workflow/Checkmark'

export default function EditToggle ({ editing, onChange }) {
  return (
    <ActionButton onPress={() => onChange(!editing)}>
      {editing ? <Checkmark /> : <Edit />}
      <Text>{editing ? 'Done' : 'Edit'}</Text>
    </ActionButton>
  )
}
