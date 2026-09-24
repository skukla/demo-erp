/*
 * Adding a pricing rule. A dialog behind the page's own Add button rather than a form
 * standing beside the list: a page's actions belong in its header (Frame), and a form
 * pinned to the right of a table leaves the table squeezed into half a wide screen for
 * the whole time nobody is adding anything.
 *
 * Customer and product are VALUE HELP — a list to choose from — not boxes to type an id
 * into. Every ERP has value help on a key field, and typing C000102 by hand on stage
 * reads as a prototype (and is a live typo risk). The dates and the minimum quantity are
 * the two fields a B2B pricing person's eye goes to first on a conditions table.
 */
import React, { useState } from 'react'
import {
  Button, ButtonGroup, ComboBox, Content, Dialog, DialogTrigger, Divider, Form, Heading, Item,
  NumberField, Picker, Text, TextField
} from '@adobe/react-spectrum'

/* Each option says what the rule does and who it covers, because that is the whole
   decision being made here. The code follows, for an SAP eye. */
const KINDS = [
  { key: 'contractPrice', label: 'Agreed price — one customer pays a set price for one product (CP01)' },
  { key: 'contractDiscount', label: 'Customer discount — one customer gets a percentage off (CD01)' },
  { key: 'maxDiscount', label: 'Discount limit — nothing may be sold below this (MD01)' }
]

const EMPTY = { kind: 'contractDiscount', partnerId: '', sku: '', price: 0, percent: 10, validFrom: '', validTo: '', minQty: null }

/** A ComboBox over records: shows "id · name", answers the id. */
export function RecordPicker ({ label, description, items, selectedKey, onChange, isRequired }) {
  return (
    <ComboBox
      label={label}
      description={description}
      defaultItems={items}
      selectedKey={selectedKey || null}
      onSelectionChange={(key) => onChange(key ? String(key) : '')}
      isRequired={isRequired}
      width='100%'
    >
      {(item) => <Item key={item.id} textValue={`${item.id} ${item.name}`}><Text>{item.id}</Text><Text slot='description'>{item.name}</Text></Item>}
    </ComboBox>
  )
}

/** Customers and products as ComboBox items. A variant shows under its own SKU. */
export const customerItems = (customers) => customers.map((c) => ({ id: c.id, name: c.name }))
export const productItems = (products) => products.map((p) => ({ id: p.sku, name: p.name }))

export default function AddPricingRule ({ onAdd, customers = [], products = [] }) {
  const [form, setForm] = useState(EMPTY)
  const isPrice = form.kind === 'contractPrice'
  const set = (patch) => setForm((current) => ({ ...current, ...patch }))
  // An agreed price needs both; a customer discount needs the customer; a limit needs
  // neither, because it can apply to everyone.
  const ready = isPrice
    ? Boolean(form.partnerId && form.sku)
    : form.kind !== 'contractDiscount' || Boolean(form.partnerId)
  const datesInOrder = !form.validFrom || !form.validTo || form.validTo >= form.validFrom

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
              <RecordPicker
                label='Customer'
                description={form.kind === 'maxDiscount' ? 'Leave blank to limit discounts for every customer.' : 'This rule is for one customer.'}
                items={customerItems(customers)}
                selectedKey={form.partnerId}
                onChange={(partnerId) => set({ partnerId })}
                isRequired={form.kind !== 'maxDiscount'}
              />
              <RecordPicker
                label='Product'
                description={isPrice ? 'An agreed price is for one product.' : 'Leave blank to cover every product.'}
                items={productItems(products)}
                selectedKey={form.sku}
                onChange={(sku) => set({ sku })}
                isRequired={isPrice}
              />
              {isPrice
                ? <NumberField label='Price' value={form.price} onChange={(price) => set({ price })} minValue={0} step={0.01} />
                : <NumberField label='Percent off' value={form.percent} onChange={(percent) => set({ percent })} minValue={0} maxValue={100} />}
              {/* Native date inputs: small, and the calendar is the browser's own. */}
              <TextField type='date' label='Valid from' description='Blank: from now.' value={form.validFrom} onChange={(validFrom) => set({ validFrom })} />
              <TextField
                type='date'
                label='Valid to'
                description='Blank: no end.'
                value={form.validTo}
                onChange={(validTo) => set({ validTo })}
                validationState={datesInOrder ? undefined : 'invalid'}
                errorMessage='Valid to cannot be before Valid from.'
              />
              <NumberField
                label='Minimum quantity'
                description='The rule applies from this line quantity. Blank: any quantity.'
                value={form.minQty ?? undefined}
                onChange={(minQty) => set({ minQty: Number.isFinite(minQty) ? Math.max(1, Math.round(minQty)) : null })}
                minValue={1}
                step={1}
              />
            </Form>
          </Content>
          <ButtonGroup>
            <Button variant='secondary' onPress={close}>Cancel</Button>
            <Button
              variant='accent'
              isDisabled={!ready || !datesInOrder}
              onPress={() => {
                close()
                onAdd({
                  kind: form.kind,
                  partnerId: form.partnerId || null,
                  sku: form.sku || null,
                  price: form.price,
                  percent: form.percent,
                  validFrom: form.validFrom || null,
                  validTo: form.validTo || null,
                  minQty: form.minQty
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
