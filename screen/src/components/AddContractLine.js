/*
 * Adding a line to a draft customer price list: a product, an agreed price or a line
 * discount, the quantity it prices from, and optional dates of its own (Business Central's
 * price list line). A line with no dates prices for as long as its list does; a dated line
 * beside an undated one is how "this price goes up on 1 January" is written. The product is
 * value help, as on Add rule (AddPricingRule's RecordPicker).
 */
import React, { useState } from 'react'
import { Button, ButtonGroup, Content, Dialog, DialogTrigger, Divider, Form, Heading, Item, NumberField, Picker, TextField } from '@adobe/react-spectrum'
import { RecordPicker, productItems } from './AddPricingRule'

const KINDS = [
  { key: 'price', label: 'Agreed price: the customer pays a set price' },
  { key: 'discount', label: 'Line discount: a percentage off the list price' }
]

const EMPTY = { sku: '', kind: 'price', price: 0, percent: 10, minQty: 1, startingDate: '', endingDate: '' }

export default function AddContractLine ({ products = [], onAdd, isDisabled }) {
  const [form, setForm] = useState(EMPTY)
  const set = (patch) => setForm((current) => ({ ...current, ...patch }))
  const isPrice = form.kind === 'price'
  const datesInOrder = !form.startingDate || !form.endingDate || form.endingDate >= form.startingDate

  return (
    <DialogTrigger onOpenChange={(open) => { if (open) setForm(EMPTY) }}>
      <Button variant='secondary' isDisabled={isDisabled}>Add line</Button>
      {(close) => (
        <Dialog>
          <Heading>Add a Price List Line</Heading>
          <Divider />
          <Content>
            <Form>
              <RecordPicker label='Product' items={productItems(products)} selectedKey={form.sku} onChange={(sku) => set({ sku })} isRequired />
              <Picker label='Line type' selectedKey={form.kind} onSelectionChange={(k) => set({ kind: String(k) })}>
                {KINDS.map((k) => <Item key={k.key}>{k.label}</Item>)}
              </Picker>
              {isPrice
                ? <NumberField label='Price' value={form.price} onChange={(price) => set({ price })} minValue={0} step={0.01} />
                : <NumberField label='Percent off' value={form.percent} onChange={(percent) => set({ percent })} minValue={0.01} maxValue={100} />}
              <NumberField
                label='From quantity'
                description='The line prices from this quantity.'
                value={form.minQty}
                onChange={(minQty) => set({ minQty: Number.isFinite(minQty) ? Math.max(1, Math.round(minQty)) : 1 })}
                minValue={1}
                step={1}
              />
              <TextField type='date' label='Starting date' description='Blank: as the list.' value={form.startingDate} onChange={(startingDate) => set({ startingDate })} />
              <TextField
                type='date'
                label='Ending date'
                description='Blank: as the list.'
                value={form.endingDate}
                onChange={(endingDate) => set({ endingDate })}
                validationState={datesInOrder ? undefined : 'invalid'}
                errorMessage='The ending date cannot be before the starting date.'
              />
            </Form>
          </Content>
          <ButtonGroup>
            <Button variant='secondary' onPress={close}>Cancel</Button>
            <Button
              variant='accent'
              isDisabled={!form.sku || !datesInOrder}
              onPress={() => {
                close()
                const dates = { startingDate: form.startingDate || null, endingDate: form.endingDate || null }
                onAdd(isPrice
                  ? { sku: form.sku, kind: 'price', price: form.price, minQty: form.minQty, ...dates }
                  : { sku: form.sku, kind: 'discount', percent: form.percent, minQty: form.minQty, ...dates })
              }}
            >
              Add line
            </Button>
          </ButtonGroup>
        </Dialog>
      )}
    </DialogTrigger>
  )
}
