/*
 * Adding a pricing condition. It is a dialog rather than a form standing beside the
 * grid: a page's actions belong in its header (Frame), and a form pinned to the right of
 * a table leaves the table squeezed into half a wide screen for the whole time nobody is
 * adding anything.
 */
import React, { useState } from 'react'
import {
  Button, ButtonGroup, Content, Dialog, DialogTrigger, Divider, Form, Heading, Item,
  NumberField, Picker, TextField
} from '@adobe/react-spectrum'

const KINDS = [
  { key: 'contractPrice', label: 'CP01 · Contract price — one customer, one product' },
  { key: 'contractDiscount', label: 'CD01 · Contract discount — one customer, any product' },
  { key: 'maxDiscount', label: 'MD01 · Maximum discount — the ceiling, anyone' }
]

const EMPTY = { kind: 'contractDiscount', partnerId: '', sku: '', price: 0, percent: 10 }

export default function AddCondition ({ onAdd }) {
  const [form, setForm] = useState(EMPTY)
  const isPrice = form.kind === 'contractPrice'
  const set = (patch) => setForm((current) => ({ ...current, ...patch }))
  // A contract price needs both; a discount needs the customer; a ceiling needs neither.
  const ready = isPrice
    ? Boolean(form.partnerId && form.sku)
    : form.kind !== 'contractDiscount' || Boolean(form.partnerId)

  return (
    <DialogTrigger onOpenChange={(open) => { if (open) setForm(EMPTY) }}>
      <Button variant='accent'>Add condition</Button>
      {(close) => (
        <Dialog>
          <Heading>Add a pricing condition</Heading>
          <Divider />
          <Content>
            <Form>
              <Picker label='Condition' selectedKey={form.kind} onSelectionChange={(k) => set({ kind: String(k) })}>
                {KINDS.map((k) => <Item key={k.key}>{k.label}</Item>)}
              </Picker>
              {/* The help has to follow the condition: saying "blank applies it to every
                  customer" beside a field marked required contradicts itself. */}
              <TextField
                label='Sold-to'
                description={form.kind === 'maxDiscount'
                  ? 'Blank applies the ceiling to every customer.'
                  : 'This condition is for one customer.'}
                value={form.partnerId}
                onChange={(partnerId) => set({ partnerId })}
                isRequired={form.kind !== 'maxDiscount'}
              />
              <TextField
                label='Product'
                description={isPrice
                  ? 'A contract price is for one product.'
                  : 'Blank applies it to every product.'}
                value={form.sku}
                onChange={(sku) => set({ sku })}
                isRequired={isPrice}
              />
              {isPrice
                ? <NumberField label='Price' value={form.price} onChange={(price) => set({ price })} minValue={0} step={0.01} />
                : <NumberField label='Percent' value={form.percent} onChange={(percent) => set({ percent })} minValue={0} maxValue={100} />}
            </Form>
          </Content>
          <ButtonGroup>
            <Button variant='secondary' onPress={close}>Cancel</Button>
            <Button
              variant='accent'
              isDisabled={!ready}
              onPress={() => {
                close()
                onAdd({
                  kind: form.kind,
                  partnerId: form.partnerId || null,
                  sku: form.sku || null,
                  price: form.price,
                  percent: form.percent
                })
              }}
            >
              Add condition
            </Button>
          </ButtonGroup>
        </Dialog>
      )}
    </DialogTrigger>
  )
}
