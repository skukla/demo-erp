/*
 * One sales order's document. The list holds a row; this holds the order the way an ERP
 * holds it — a header of labelled fields, numbered lines, the money, and what the order
 * became: its shipments and its invoice, each a document that opens.
 *
 * The actions live here rather than on the list. An ERP acts on an order from the
 * order's own document: you look at what you are about to change before you change it.
 * Which actions are open is the ERP's call (`can`), not the screen's — Create invoice
 * appears only when every line has shipped or been closed, because that is the rule.
 * Cancelling asks why, from the ERP's own list of reasons (lib/orders CANCEL_REASONS,
 * sent with the document so the screen keeps no second copy of it).
 */
import React, { useState } from 'react'
import { Button, ButtonGroup, Content, DialogTrigger, Dialog, Divider, Heading, Item, Picker, Text } from '@adobe/react-spectrum'
import DocumentPage from './DocumentPage'
import OrderHeader from './OrderHeader'
import OrderLines from './OrderLines'
import RelatedDocuments from './RelatedDocuments'
import CreateShipment from './CreateShipment'
import Timeline from './Timeline'
import { useLoad } from './useLoad'
import { toastSaved } from './toast'

/** Cancel: pick a reason, then confirm. The dialog is the only way to reach it. */
function CancelOrder ({ reasons, onCancel, isDisabled }) {
  const [reason, setReason] = useState(reasons[0])
  return (
    <DialogTrigger>
      <Button variant='negative' isDisabled={isDisabled}>Cancel order</Button>
      {(close) => (
        <Dialog>
          <Heading>Cancel This Order?</Heading>
          <Divider />
          <Content>
            <Text>
              The order stays on record, cancelled. It cannot be
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

/**
 * @param {object} props `backLabel` names where Back goes; `onOpen(kind, number)` opens
 *   a related document (a shipment, the invoice, the customer) on the same trail.
 */
export default function OrderDetail ({ api, number, backLabel = 'Sales Orders', onBack, onOpen, onChanged }) {
  const { rows, error, reload } = useLoad(async () => [await api.order(number)], [api, number])
  const order = rows && rows[0]
  const [actionError, setActionError] = useState(null)
  const [busy, setBusy] = useState(false)

  /* Every action: ask the ERP, read the document again, tell the shell. The document is
     re-read rather than patched because most moves change several things at once — a
     posted shipment moves quantities, statuses and the related-documents strip. */
  async function act (call, saved) {
    setBusy(true)
    try {
      await call()
      setActionError(null)
      await reload()
      if (saved) toastSaved(saved)
      onChanged()
    } catch (e) {
      setActionError(e)
    }
    setBusy(false)
  }

  const can = (order && order.can) || {}
  return (
    <DocumentPage
      backLabel={backLabel}
      onBack={onBack}
      title={order ? `Sales Order ${order.number}` : ''}
      subtitle={order && order.partner ? `${order.partner.id} · ${order.partner.name}` : undefined}
      error={actionError || error}
      loading={!order}
      actions={order && (
        <>
          {/* SAP's pair on a blocked document. Release lets the order proceed; Reject cancels it
              with the reason Commerce hears. Confirm is not offered while the hold stands. */}
          {can.release && <Button variant='accent' isDisabled={busy} onPress={() => act(() => api.releaseCredit(number), 'Credit hold released')}>Release</Button>}
          {can.reject && <Button variant='negative' isDisabled={busy} onPress={() => act(() => api.rejectCredit(number), 'Order rejected — Credit rejected')}>Reject</Button>}
          {can.confirm && <Button variant='accent' isDisabled={busy} onPress={() => act(() => api.confirmOrder(number), 'Order confirmed')}>Confirm</Button>}
          {can.ship && <CreateShipment key={order.shipments.length} order={order} isDisabled={busy} onCreate={(body) => act(() => api.createShipment(number, body), 'Shipment created — post it to ship the goods')} />}
          {can.invoice && <Button variant='accent' isDisabled={busy} onPress={() => act(() => api.createInvoice(number), 'Invoice created')}>Create invoice</Button>}
          {can.cancel && (
            <CancelOrder reasons={order.cancelReasons} isDisabled={busy} onCancel={(reason) => act(() => api.cancelOrder(number, reason), 'Order cancelled')} />
          )}
        </>
      )}
    >
      {order && (
        <>
          <OrderHeader order={order} onOpen={onOpen} />
          <OrderLines order={order} busy={busy} onOpen={onOpen} onCloseLine={(item, reason) => act(() => api.closeLine(number, item, reason), `Item ${item} closed`)} />
          <RelatedDocuments order={order} onOpen={onOpen} />
          <Timeline order={order} onOpen={onOpen} />
        </>
      )}
    </DocumentPage>
  )
}
