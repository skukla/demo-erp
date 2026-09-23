/*
 * Adding a pricing rule. A dialog behind the page's own Add button rather than a form
 * standing beside the list: a page's actions belong in its header (Frame), and a form
 * pinned to the right of a table leaves the table squeezed into half a wide screen for
 * the whole time nobody is adding anything.
 */
import React, { useState } from 'react'
import {
  Button, ButtonGroup, Content, Dialog, DialogTrigger, Divider, Form, Heading, Item,
  NumberField, Picker, TextField
} from '@adobe/react-spectrum'

/* Each option says what the rule does and who it covers, because that is the whole
   decision being made here. The code follows, for an SAP eye. */
const KINDS = [
  { key: 'contractPrice', label: 'Agreed price — one customer pays a set price for one product (CP01)' },
  { key: 'contractDiscount', label: 'Customer discount — one customer gets a percentage off (CD01)' },
  { key: 'maxDiscount', label: 'Discount limit — nothing may be sold below this (MD01)' }
]

const EMPTY = { kind: 'contractDiscount', partnerId: '', sku: '', price: 0, percent: 10 }

export default function AddPricingRule ({ onAdd }) {
  const [form, setForm] = useState(EMPTY)
  const isPrice = form.kind === 'contractPrice'
  const set = (patch) => setForm((current) => ({ ...current, ...patch }))
  // An agreed price needs both; a customer discount needs the customer; a limit needs
  // neither, because it can apply to everyone.
  const ready = isPrice
    ? Boolean(form.partnerId && form.sku)
    : form.kind !== 'contractDiscount' || Boolean(form.partnerId)

  return (
    <DialogTrigger onOpenChange={(open) => { if (open) setForm(EMPTY) }}>
      <Button variant='accent'>Add rule</Button>
      {(close) => (
        <Dialog>
          <Heading>Add a Pricing Rule</Heading>
          <Divider />
          <Content>
            <Form>
              <Picker label='What the rule does' selectedKey={form.kind} onSelectionChange={(k) => set({ kind: String(k) })}>
                {KINDS.map((k) => <Item key={k.key}>{k.label}</Item>)}
              </Picker>
              {/* The help has to follow the rule: saying "blank covers every customer"
                  beside a field marked required contradicts itself. */}
              <TextField
                label='Customer'
                description={form.kind === 'maxDiscount'
                  ? 'Leave blank to limit discounts for every customer.'
                  : 'This rule is for one customer.'}
                value={form.partnerId}
                onChange={(partnerId) => set({ partnerId })}
                isRequired={form.kind !== 'maxDiscount'}
              />
              <TextField
                label='Product'
                description={isPrice
                  ? 'An agreed price is for one product.'
                  : 'Leave blank to cover every product.'}
                value={form.sku}
                onChange={(sku) => set({ sku })}
                isRequired={isPrice}
              />
              {isPrice
                ? <NumberField label='Price' value={form.price} onChange={(price) => set({ price })} minValue={0} step={0.01} />
                : <NumberField label='Percent off' value={form.percent} onChange={(percent) => set({ percent })} minValue={0} maxValue={100} />}
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
              Add rule
            </Button>
          </ButtonGroup>
        </Dialog>
      )}
    </DialogTrigger>
  )
}
