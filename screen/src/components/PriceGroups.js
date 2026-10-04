/*
 * Price Groups: customer price groups, a code and a name (Business Central's customer price
 * group; SAP's customer price group). A customer joins one on its own page; a price list may
 * apply to a group instead of one customer. Like Pricing, rows are removed from the table:
 * a group has no document. The ERP refuses to remove one still in use, and says why.
 */
import React, { useMemo, useState } from 'react'
import {
  ActionButton, Button, ButtonGroup, Content, Dialog, DialogTrigger, Divider, Form, Heading,
  TableView, TableHeader, Column, TableBody, Row, Cell, TextField
} from '@adobe/react-spectrum'
import Frame from './Frame'
import { useLoad } from './useLoad'
import { toastSaved } from './toast'
import { useColumnWidths } from './columnWidths'
import { GRID_COLUMNS } from './gridColumns'

function AddPriceGroup ({ onAdd }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  return (
    <DialogTrigger onOpenChange={(open) => { if (open) { setCode(''); setName('') } }}>
      <Button variant='accent'>Add price group</Button>
      {(close) => (
        <Dialog>
          <Heading>Add a Price Group</Heading>
          <Divider />
          <Content>
            <Form>
              <TextField label='Code' description='Letters, digits, - or _; up to 20.' isRequired value={code} onChange={setCode} />
              <TextField label='Name' value={name} onChange={setName} />
            </Form>
          </Content>
          <ButtonGroup>
            <Button variant='secondary' onPress={close}>Cancel</Button>
            <Button variant='accent' isDisabled={!code.trim()} onPress={() => { close(); onAdd({ code, name }) }}>Add price group</Button>
          </ButtonGroup>
        </Dialog>
      )}
    </DialogTrigger>
  )
}

export default function PriceGroups ({ api, onChanged }) {
  const widths = useColumnWidths('priceGroups', GRID_COLUMNS.priceGroups)
  const { rows, error, reload } = useLoad(() => api.priceGroups(), [api])
  const { rows: customers } = useLoad(() => api.partners(), [api])
  const members = useMemo(() => {
    const count = new Map()
    for (const c of customers || []) if (c.priceGroup) count.set(c.priceGroup, (count.get(c.priceGroup) || 0) + 1)
    return count
  }, [customers])
  const [actionError, setActionError] = useState(null)

  async function act (call, saved) {
    try {
      await call()
      setActionError(null)
      toastSaved(saved)
      await reload()
      onChanged()
    } catch (e) { setActionError(e) }
  }

  return (
    <Frame
      title='Price Groups'
      error={actionError || error}
      loading={!rows}
      actions={<AddPriceGroup onAdd={(group) => act(() => api.savePriceGroup(group), 'Price group saved')} />}
    >
      <TableView {...widths.tableProps} aria-label='Price groups' density='compact' overflowMode='wrap'>
        <TableHeader>
          {/* The button first, where the edge never reaches (gridColumns.js); Code names the row. */}
          <Column key='remove' {...widths.columnProps('remove')}> </Column>
          <Column key='code' {...widths.columnProps('code')} isRowHeader>Code</Column>
          <Column key='name' {...widths.columnProps('name')}>Name</Column>
          <Column key='customers' {...widths.columnProps('customers')} align='end'>Customers</Column>
        </TableHeader>
        <TableBody items={(rows || []).map((g) => ({ ...g, id: g.code }))}>
          {(g) => (
            <Row key={g.code}>
              <Cell><ActionButton isQuiet onPress={() => act(() => api.deletePriceGroup(g.code), 'Price group removed')}>Remove</ActionButton></Cell>
              <Cell><span className='erp-key'>{g.code}</span></Cell>
              <Cell>{g.name}</Cell>
              <Cell>{members.get(g.code) || 0}</Cell>
            </Row>
          )}
        </TableBody>
      </TableView>
    </Frame>
  )
}
