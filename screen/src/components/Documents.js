/*
 * Opening documents from documents. An order opens its shipment, a shipment opens its
 * order, a customer opens an order — and Back goes to where you came from, not to the
 * list. Every list page keeps a TRAIL of the documents opened from it and renders the
 * top one; this file is the trail and the one place that knows which component shows
 * which kind of document.
 */
import React, { useEffect, useState } from 'react'
import OrderDetail from './OrderDetail'
import ShipmentDetail from './ShipmentDetail'
import InvoiceDetail from './InvoiceDetail'
import CustomerDetail from './CustomerDetail'
import ProductDetail from './ProductDetail'

const VIEWS = { order: OrderDetail, shipment: ShipmentDetail, invoice: InvoiceDetail, customer: CustomerDetail, product: ProductDetail }

/** What a document is called when Back points at it. */
export function labelOf (entry) {
  if (entry.kind === 'order') return `Sales Order ${entry.number}`
  if (entry.kind === 'shipment') return `Shipment ${entry.number}`
  if (entry.kind === 'invoice') return `Invoice ${entry.number}`
  if (entry.kind === 'product') return `Product ${entry.number}`
  return entry.title || `Customer ${entry.number}`
}

/**
 * @returns {object} `top` (the open document or null), `open(kind, number)`, `back()`
 *   and `backLabel` — the list's name, or the document underneath
 */
export function useTrail (listLabel) {
  const [trail, setTrail] = useState([])
  const top = trail.length > 0 ? trail[trail.length - 1] : null
  return {
    top,
    depth: trail.length,
    open: (kind, number, title) => setTrail((t) => [...t, { kind, number, title }]),
    back: () => setTrail((t) => t.slice(0, -1)),
    backLabel: trail.length > 1 ? labelOf(trail[trail.length - 2]) : listLabel
  }
}

/**
 * Open the document the address bar names (`?open=<number>`) when the list mounts: how
 * a search result, a recent document on Home and a journal line reach a document.
 */
export function useOpenFromQuery (trail, query, kind) {
  const number = query && query.open
  useEffect(() => {
    if (number) trail.open(kind, String(number))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * The document on top of a trail.
 *
 * @param {object} props `trail` from useTrail; `api`, `onChanged`, `onNavigate` as every
 *   page receives them; `onClose` runs when the last document closes back to the list
 */
export function OpenDocument ({ trail, api, onChanged, onNavigate, onClose }) {
  const entry = trail.top
  const View = VIEWS[entry.kind]
  const onBack = () => { trail.back(); if (trail.depth === 1 && onClose) onClose() }
  // A product page opened from an order line: it takes a SKU, and opens other products
  // (a parent's variants) by SKU alone, so its onOpen is adapted to the trail's kinds.
  if (entry.kind === 'product') {
    return (
      <View
        key={`product:${entry.number}`}
        api={api}
        sku={entry.number}
        backLabel={trail.backLabel}
        onBack={onBack}
        onOpen={(sku) => trail.open('product', sku)}
        onChanged={onChanged}
        onNavigate={onNavigate}
      />
    )
  }
  return (
    <View
      key={`${entry.kind}:${entry.number}`}
      api={api}
      number={entry.number}
      id={entry.number}
      backLabel={trail.backLabel}
      onBack={onBack}
      onOpen={trail.open}
      onChanged={onChanged}
      onNavigate={onNavigate}
    />
  )
}
