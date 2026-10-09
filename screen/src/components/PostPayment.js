/*
 * Post payment: an incoming payment against an invoice (contract version 14), offered on the
 * invoice and on its order, whose next step it is while money is open. The amount
 * starts as everything open and can be lowered for a partial payment; a reference (a check
 * number, a bank reference) is optional. A payment cannot be undone in the ERP, so it asks
 * first, as Post credit memo does. The ERP's refusal of an amount, in its own words, shows
 * on the page it was posted from.
 */
import React, { useState } from 'react'
import { Button, ButtonGroup, Content, Dialog, DialogTrigger, Divider, Form, Heading, NumberField, Text, TextField } from '@adobe/react-spectrum'
import { moneyOptions } from '../money'

/**
 * @param {object} props `openAmount` and `currency` of the invoice; `onPost({ amount, reference })`
 *   runs on confirmation; `isDisabled` while a move is in flight
 */
export default function PostPayment ({ openAmount, currency, onPost, isDisabled }) {
  const [amount, setAmount] = useState(openAmount)
  const [reference, setReference] = useState('')
  return (
    <DialogTrigger onOpenChange={(open) => { if (open) { setAmount(openAmount); setReference('') } }}>
      <Button variant='accent' isDisabled={isDisabled}>Post payment</Button>
      {(close) => (
        <Dialog>
          <Heading>Post a Payment</Heading>
          <Divider />
          <Content>
            <Form onSubmit={(e) => e.preventDefault()}>
              <NumberField label='Amount' value={amount} onChange={setAmount} minValue={0} formatOptions={moneyOptions(currency)} autoFocus />
              <TextField label='Reference' value={reference} onChange={setReference} description='Optional: a check number or bank reference' />
            </Form>
            <Text>A payment cannot be undone in the ERP.</Text>
          </Content>
          <ButtonGroup>
            <Button variant='secondary' onPress={close}>Keep as it is</Button>
            <Button variant='accent' isDisabled={!(amount > 0)} onPress={() => { close(); onPost({ amount, reference: reference.trim() || undefined }) }}>Post payment</Button>
          </ButtonGroup>
        </Dialog>
      )}
    </DialogTrigger>
  )
}
