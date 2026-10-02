/*
 * One section of the ERP's setup, as Business Central's setup pages edit one: it reads as
 * display until someone chooses Edit, then its fields are controls, Save keeps them and
 * Cancel puts the page back as it was. A refusal is shown in the ERP's own words, and the
 * fields stay as typed so they can be corrected.
 */
import React, { useState } from 'react'
import { ActionButton, Button, ButtonGroup, Content, Heading, InlineAlert, Text } from '@adobe/react-spectrum'
import Edit from '@spectrum-icons/workflow/Edit'
import Card from './Card'
import { toastSaved } from './toast'

/**
 * @param {object} props
 * @param {string} props.title
 * @param {object} props.value what the section shows; Edit starts the draft from it
 * @param {(draft: object) => Promise<void>} props.onSave keeps the draft, or throws the refusal
 * @param {(value: object) => React.ReactNode} props.view the section in display
 * @param {(draft: object, setDraft: Function) => React.ReactNode} props.form the section in edit
 */
export default function SetupCard ({ title, value, onSave, view, form }) {
  const [draft, setDraft] = useState(null)
  const [refusal, setRefusal] = useState(null)
  const [saving, setSaving] = useState(false)
  const editing = draft !== null

  function cancel () {
    setDraft(null)
    setRefusal(null)
  }

  async function save () {
    setSaving(true)
    try {
      await onSave(draft)
      setDraft(null)
      setRefusal(null)
      toastSaved(`${title} saved`)
    } catch (e) {
      setRefusal(e.message)
    }
    setSaving(false)
  }

  const actions = editing
    ? (
      <ButtonGroup>
        <Button variant='secondary' onPress={cancel} isDisabled={saving}>Cancel</Button>
        <Button variant='accent' onPress={save} isPending={saving}>Save</Button>
      </ButtonGroup>
      )
    : (
      <ActionButton onPress={() => setDraft(value)} aria-label={`Edit ${title.toLowerCase()}`}>
        <Edit />
        <Text>Edit</Text>
      </ActionButton>
      )

  return (
    <Card title={title} actions={actions}>
      {refusal && (
        <InlineAlert variant='negative' marginBottom='size-200'>
          <Heading>Not saved</Heading>
          <Content>{refusal}</Content>
        </InlineAlert>
      )}
      {editing ? form(draft, setDraft) : view(value)}
    </Card>
  )
}
