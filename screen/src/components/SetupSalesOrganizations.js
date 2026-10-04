/*
 * Settings → Sales Organizations: the ERP's own (AB-26y step 2), a table with Add and Edit.
 * The first fill seeded them; from then on they are changed here, and their names and
 * currencies are what the customer document and the invoice's seller block print
 * (lib/sales-organizations.js). A code is fixed once added: orders and customers carry it.
 */
import React, { useState } from 'react'
import {
  ActionButton, Button, ButtonGroup, Content, Dialog, DialogContainer, Divider, Form, Heading,
  InlineAlert, TableView, TableHeader, Column, TableBody, Row, Cell, TextField
} from '@adobe/react-spectrum'
import Card from './Card'
import { toastSaved } from './toast'
import { useColumnWidths } from './columnWidths'
import { GRID_COLUMNS } from './gridColumns'

const BLANK = { code: '', name: '', currency: '', websiteCode: '' }

/** Add (no `editing`) or edit one sales organization; a refusal stays in the dialog, in the ERP's words. */
function SalesOrgDialog ({ editing, onSubmit, close }) {
  const [draft, setDraft] = useState(editing ? { ...editing, websiteCode: editing.websiteCode || '' } : BLANK)
  const [refusal, setRefusal] = useState(null)
  const [saving, setSaving] = useState(false)
  const set = (key) => (value) => setDraft({ ...draft, [key]: value })

  async function submit () {
    setSaving(true)
    try {
      await onSubmit(draft)
      close()
    } catch (e) {
      setRefusal(e.message)
      setSaving(false)
    }
  }

  return (
    <Dialog>
      <Heading>{editing ? `Edit Sales Organization ${editing.code}` : 'Add a Sales Organization'}</Heading>
      <Divider />
      <Content>
        {refusal && (
          <InlineAlert variant='negative' marginBottom='size-200'>
            <Heading>Not saved</Heading>
            <Content>{refusal}</Content>
          </InlineAlert>
        )}
        <Form>
          <TextField label='Code' value={draft.code} onChange={set('code')} isDisabled={Boolean(editing)} isRequired description={editing ? 'Fixed: orders and customers carry it.' : '1 to 4 letters or digits.'} />
          <TextField label='Name' value={draft.name} onChange={set('name')} isRequired />
          <TextField label='Currency' value={draft.currency} onChange={set('currency')} isRequired description='Three letters, such as EUR.' />
          <TextField label='Website' value={draft.websiteCode} onChange={set('websiteCode')} description="The Commerce website's code, such as base." />
        </Form>
      </Content>
      <ButtonGroup>
        <Button variant='secondary' onPress={close} isDisabled={saving}>Cancel</Button>
        <Button variant='accent' onPress={submit} isPending={saving}>{editing ? 'Save' : 'Add'}</Button>
      </ButtonGroup>
    </Dialog>
  )
}

export default function SetupSalesOrganizations ({ salesOrganizations, onAdd, onEdit }) {
  const widths = useColumnWidths('salesOrganizations', GRID_COLUMNS.salesOrganizations)
  const [rows, setRows] = useState(salesOrganizations)
  // null: no dialog; {}: adding; a row: editing it.
  const [open, setOpen] = useState(null)

  async function submit (draft) {
    const { code, ...fields } = draft
    const setup = open.code ? await onEdit(open.code, fields) : await onAdd(draft)
    setRows(setup.salesOrganizations)
    toastSaved(open.code ? `Sales organization ${open.code} saved` : `Sales organization ${code.trim().toUpperCase()} added`)
  }

  return (
    <Card title='Sales Organizations' actions={<ActionButton onPress={() => setOpen({})}>Add</ActionButton>}>
      <TableView {...widths.tableProps} aria-label='Sales organizations' density='compact' overflowMode='wrap' renderEmptyState={() => 'None yet: the first fill brings them from the websites.'}>
        <TableHeader>
          {/* The button first, where the edge never reaches (gridColumns.js); Code names the row. */}
          <Column key='edit' {...widths.columnProps('edit')}> </Column>
          <Column key='code' {...widths.columnProps('code')} isRowHeader>Code</Column>
          <Column key='name' {...widths.columnProps('name')}>Name</Column>
          <Column key='currency' {...widths.columnProps('currency')}>Currency</Column>
          <Column key='website' {...widths.columnProps('website')}>Website</Column>
        </TableHeader>
        <TableBody items={rows.map((o) => ({ ...o, id: o.code }))}>
          {(o) => (
            <Row key={o.code}>
              <Cell><ActionButton isQuiet onPress={() => setOpen(o)} aria-label={`Edit sales organization ${o.code}`}>Edit</ActionButton></Cell>
              <Cell><span className='erp-key'>{o.code}</span></Cell>
              <Cell>{o.name}</Cell>
              <Cell>{o.currency || '—'}</Cell>
              <Cell>{o.websiteCode || '—'}</Cell>
            </Row>
          )}
        </TableBody>
      </TableView>
      <DialogContainer onDismiss={() => setOpen(null)}>
        {open && <SalesOrgDialog editing={open.code ? open : null} onSubmit={submit} close={() => setOpen(null)} />}
      </DialogContainer>
    </Card>
  )
}
