/*
 * Post credit memo: the one move on a document that cannot be undone, in the ERP as in
 * Commerce (contract creditMemo note), so it asks first — as Cancel order does.
 */
import React from 'react'
import { Button, ButtonGroup, Content, Dialog, DialogTrigger, Divider, Heading, Text } from '@adobe/react-spectrum'

/**
 * @param {object} props `what` names what is credited ("this invoice in full"); `onPost`
 *   runs on confirmation; `isDisabled` while a move is in flight
 */
export default function PostCreditMemo ({ what, onPost, isDisabled }) {
  return (
    <DialogTrigger>
      <Button variant='accent' isDisabled={isDisabled}>Post credit memo</Button>
      {(close) => (
        <Dialog>
          <Heading>Post a Credit Memo?</Heading>
          <Divider />
          <Content>
            <Text>
              The credit memo credits {what}. It cannot be undone, here or in Commerce.
            </Text>
          </Content>
          <ButtonGroup>
            <Button variant='secondary' onPress={close}>Keep as it is</Button>
            <Button variant='accent' onPress={() => { close(); onPost() }}>Post credit memo</Button>
          </ButtonGroup>
        </Dialog>
      )}
    </DialogTrigger>
  )
}
