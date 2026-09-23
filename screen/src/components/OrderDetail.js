/*
 * One sales order's document. The list holds a row; this holds the order the way an ERP
 * holds it — a header of labelled fields, numbered lines, the money, and what the order
 * became.
 *
 * The actions live here rather than on the list. An ERP acts on an order from the
 * order's own document: you look at what you are about to change before you change it.
 * Cancelling asks why, from the ERP's own list of reasons (lib/orders CANCEL_REASONS,
 * sent with the document so the screen keeps no second copy of it).
 */
import React, { useState } from 'react'
import {
  ActionButton, Button, ButtonGroup, Content, DialogTrigger, Dialog, Divider, Flex, Heading,
  InlineAlert, Item, Picker, Text
} from '@adobe/react-spectrum'
import ChevronLeft from '@spectrum-icons/workflow/ChevronLeft'
import PageLoading from './PageLoading'
import OrderHeader from './OrderHeader'
import OrderLines from './OrderLines'
import RelatedDocuments from './RelatedDocuments'
import { useLoad } from './useLoad'

/* A document's buttons are verbs — what you are about to do — not the name of the
   status you are about to land in. Both reference systems read this way. */
const ACTION_LABEL = { confirmed: 'Confirm', shipped: 'Ship', invoiced: 'Invoice', cancelled: 'Cancel order' }

/** Cancel: pick a reason, then confirm. The dialog is the only way to reach it. */
function CancelOrder ({ reasons, onCancel, isDisabled }) {
  const [reason, setReason] = useState(reasons[0])
  return (
    <DialogTrigger>
      <Button variant='negative' isDisabled={isDisabled}>{ACTION_LABEL.cancelled}</Button>
      {(close) => (
        <Dialog>
          <Heading>Cancel this order?</Heading>
          <Divider />
          <Content>
            <Text>
              The order stays in the ERP and in Commerce, cancelled. It cannot be
              reopened — an order that should run again is placed again.
            </Text>
            <Picker
              label='Reason'
              items={reasons.map((r) => ({ id: r }))}
              selectedKey={reason}
              onSelectionChange={(key) => setReason(String(key))}
              marginTop='size-200'
              width='100%'
            >
              {(item) => <Item key={item.id}>{item.id}</Item>}
            </Picker>
          </Content>
          <ButtonGroup>
            <Button variant='secondary' onPress={close}>Keep the order</Button>
            <Button variant='negative' onPress={() => { close(); onCancel(reason) }}>
              Cancel order
            </Button>
          </ButtonGroup>
        </Dialog>
      )}
    </DialogTrigger>
  )
}

export default function OrderDetail ({ api, number, onBack, onChanged }) {
  const { rows, error, reload } = useLoad(async () => [await api.order(number)], [api, number])
  const order = rows && rows[0]
  const [moveError, setMoveError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function move (status, reason) {
    setBusy(true)
    try {
      await api.moveOrder(number, status, reason)
      setMoveError(null)
      await reload()
      onChanged()
    } catch (e) {
      setMoveError(e)
    }
    setBusy(false)
  }

  if (!order) {
    return (
      <>
        <ActionButton isQuiet onPress={onBack} marginBottom='size-150'>
          <ChevronLeft />
          <Text>Sales orders</Text>
        </ActionButton>
        {error
          ? (
            <InlineAlert variant='negative'>
              <Heading>Something went wrong</Heading>
              <Content>{error.message}</Content>
            </InlineAlert>
            )
          : <PageLoading />}
      </>
    )
  }

  const forward = (order.nextStatuses || []).filter((s) => s !== 'cancelled')
  const canCancel = (order.cancelReasons || []).length > 0
  return (
    <>
      <ActionButton isQuiet onPress={onBack} marginBottom='size-150'>
        <ChevronLeft />
        <Text>Sales orders</Text>
      </ActionButton>
      <div className='erp-page-header'>
        <Heading level={1} marginY={0}>Sales order {order.number}</Heading>
        <div className='erp-page-actions'>
          {forward.map((status) => (
            <Button key={status} variant='accent' isDisabled={busy} onPress={() => move(status)}>
              {ACTION_LABEL[status] || status}
            </Button>
          ))}
          {canCancel && (
            <CancelOrder
              reasons={order.cancelReasons}
              isDisabled={busy}
              onCancel={(reason) => move('cancelled', reason)}
            />
          )}
        </div>
      </div>
      {(moveError || error) && (
        <InlineAlert variant='negative' marginBottom='size-200'>
          <Heading>Something went wrong</Heading>
          <Content>{(moveError || error).message}</Content>
        </InlineAlert>
      )}
      <OrderHeader order={order} />
      <OrderLines order={order} />
      <RelatedDocuments order={order} />
    </>
  )
}
