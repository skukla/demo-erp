/*
 * Creating a shipment: which lines, how many of each, and — when the store has more than
 * one warehouse — which one it ships from. Every quantity defaults to what is still open
 * and can only be edited DOWN; the ERP refuses anything else anyway, and a form that
 * offers more than it will accept reads as a prototype.
 *
 * The shipment is created open. Posting it, on the shipment's own document, is what
 * moves the goods and tells Commerce.
 */
import React, { useState } from 'react'
import {
  Button, ButtonGroup, Content, Dialog, DialogTrigger, Divider, Heading, Item, NumberField, Picker, Text,
  TableView, TableHeader, Column, TableBody, Row, Cell, View
} from '@adobe/react-spectrum'

export default function CreateShipment ({ order, onCreate, isDisabled }) {
  const open = (order.lines || []).filter((l) => l.openQty > 0)
  const warehouses = order.warehouses || []
  const [qty, setQty] = useState({})
  const [warehouse, setWarehouse] = useState(warehouses[0] ? warehouses[0].code : null)
  const quantityOf = (line) => (qty[line.item] === undefined ? line.openQty : qty[line.item])
  const lines = open.map((l) => ({ item: l.item, qty: quantityOf(l) })).filter((l) => l.qty > 0)
  const total = lines.reduce((sum, l) => sum + l.qty, 0)

  return (
    <DialogTrigger onOpenChange={(isOpen) => { if (isOpen) setQty({}) }}>
      <Button variant='accent' isDisabled={isDisabled}>Create shipment</Button>
      {(close) => (
        <Dialog size='L'>
          <Heading>Create a Shipment</Heading>
          <Divider />
          <Content>
            <Text>Each line ships what is still open unless you take some out. Nothing moves until the shipment is posted.</Text>
            <View marginTop='size-200'>
              <TableView aria-label='Lines to ship' density='compact'>
                <TableHeader>
                  <Column key='item' width={70}>Item</Column>
                  <Column key='name' width='1fr'>Product</Column>
                  <Column key='open' width={90} align='end'>Open</Column>
                  <Column key='ship' width={170} align='end'>Ship now</Column>
                </TableHeader>
                <TableBody items={open.map((l) => ({ ...l, id: l.item }))}>
                  {(line) => (
                    <Row key={line.item}>
                      <Cell>{line.item}</Cell>
                      <Cell>{`${line.sku} · ${line.name}`}</Cell>
                      <Cell>{`${line.openQty} ${line.unit}`}</Cell>
                      <Cell>
                        <NumberField
                          aria-label={`Quantity for item ${line.item}`}
                          value={quantityOf(line)}
                          minValue={0}
                          maxValue={line.openQty}
                          step={1}
                          isQuiet
                          width='size-1250'
                          onChange={(v) => setQty((q) => ({ ...q, [line.item]: Number.isFinite(v) ? Math.max(0, Math.min(line.openQty, Math.round(v))) : 0 }))}
                        />
                      </Cell>
                    </Row>
                  )}
                </TableBody>
              </TableView>
            </View>
            {/* One warehouse is not a choice; the picker appears only when there is one to make. */}
            {warehouses.length > 1 && (
              <Picker
                label='Ship from'
                items={warehouses.map((w) => ({ id: w.code, name: w.name }))}
                selectedKey={warehouse}
                onSelectionChange={(key) => setWarehouse(String(key))}
                marginTop='size-200'
                width='size-3600'
              >
                {(w) => <Item key={w.id}>{`${w.name} · ${w.id}`}</Item>}
              </Picker>
            )}
          </Content>
          <ButtonGroup>
            <Button variant='secondary' onPress={close}>Cancel</Button>
            <Button
              variant='accent'
              isDisabled={total === 0}
              onPress={() => { close(); onCreate({ lines, warehouse: warehouses.length > 1 ? warehouse : (warehouses[0] ? warehouses[0].code : undefined) }) }}
            >
              {total === 0 ? 'Nothing to ship' : `Create shipment · ${total}`}
            </Button>
          </ButtonGroup>
        </Dialog>
      )}
    </DialogTrigger>
  )
}
