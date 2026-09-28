/*
 * Starting a customer price list: the header only. A dialog behind the list's own button, as
 * Add rule is on Pricing. It applies to one customer or one customer price group (Business
 * Central's "Applies-to Type"); both are value help, never a box to type an id into
 * (AddPricingRule's RecordPicker). The list is created as a draft and opened, where its lines
 * are added before anyone activates it.
 */
import React, { useState } from 'react'
import { Button, ButtonGroup, Content, Dialog, DialogTrigger, Divider, Form, Heading, Item, Picker, TextField } from '@adobe/react-spectrum'
import { RecordPicker, customerItems } from './AddPricingRule'
import { todayIso } from './pricingRuleFormat'

const APPLIES_TO = [
  { key: 'customer', label: 'One customer' },
  { key: 'priceGroup', label: 'A customer price group' }
]

const empty = () => ({ appliesTo: 'customer', partnerId: '', priceGroup: '', description: '', startingDate: todayIso(), endingDate: '' })

export default function NewContract ({ customers = [], groups = [], onCreate }) {
  const [form, setForm] = useState(empty)
  const set = (patch) => setForm((current) => ({ ...current, ...patch }))
  const forGroup = form.appliesTo === 'priceGroup'
  const datesInOrder = !form.endingDate || form.endingDate >= form.startingDate
  const ready = Boolean((forGroup ? form.priceGroup : form.partnerId) && form.startingDate) && datesInOrder

  return (
    <DialogTrigger onOpenChange={(open) => { if (open) setForm(empty()) }}>
      <Button variant='accent'>New price list</Button>
      {(close) => (
        <Dialog>
          <Heading>New Price List</Heading>
          <Divider />
          <Content>
            <Form>
              <Picker label='Applies to' selectedKey={form.appliesTo} onSelectionChange={(k) => set({ appliesTo: String(k) })}>
                {APPLIES_TO.map((a) => <Item key={a.key}>{a.label}</Item>)}
              </Picker>
              {forGroup
                ? (
                  <RecordPicker
                    label='Price group'
                    description={groups.length ? 'Every customer in the group gets these prices.' : 'No price groups yet: add one under Price Groups.'}
                    items={groups.map((g) => ({ id: g.code, name: g.name }))}
                    selectedKey={form.priceGroup}
                    onChange={(priceGroup) => set({ priceGroup })}
                    isRequired
                  />
                  )
                : (
                  <RecordPicker
                    label='Customer'
                    items={customerItems(customers.filter((c) => !c.isDefault))}
                    selectedKey={form.partnerId}
                    onChange={(partnerId) => set({ partnerId })}
                    isRequired
                  />
                  )}
              <TextField label='Description' value={form.description} onChange={(description) => set({ description })} />
              <TextField type='date' label='Starting date' isRequired value={form.startingDate} onChange={(startingDate) => set({ startingDate })} />
              <TextField
                type='date'
                label='Ending date'
                description='Blank: no end.'
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
              isDisabled={!ready}
              onPress={() => {
                close()
                onCreate({
                  appliesTo: form.appliesTo,
                  ...(forGroup ? { priceGroup: form.priceGroup } : { partnerId: form.partnerId }),
                  description: form.description,
                  startingDate: form.startingDate,
                  endingDate: form.endingDate || null,
                  lines: []
                })
              }}
            >
              Create draft
            </Button>
          </ButtonGroup>
        </Dialog>
      )}
    </DialogTrigger>
  )
}
