/*
 * Product table cells that edit in place while their table is in edit mode: name,
 * price, and stock when one warehouse holds it. A configurable product's price and stock belong to its variants, and
 * stock spread over several warehouses is changed on the product's page, which
 * says where.
 */
import React from 'react'
import EditableNumber from './EditableNumber'
import EditableText from './EditableText'
import { priceText } from './productFormat'

const MONEY = { style: 'currency', currency: 'USD' }

export function NameCell ({ product, editing, onSave }) {
  if (!editing) return product.name
  return <EditableText label='Name' value={product.name} onSave={(name) => onSave({ name })} />
}

export function PriceCell ({ product, editing, onSave }) {
  if (!editing || product.type === 'configurable') return priceText(product)
  return <EditableNumber label='Price' value={product.listPrice} step={0.01} formatOptions={MONEY} onSave={(listPrice) => onSave({ listPrice })} />
}

export function StockCell ({ product, editing, onSave }) {
  const warehouses = product.warehouses || []
  if (!editing || product.type === 'configurable' || warehouses.length !== 1) return product.stock
  const [only] = warehouses
  return <EditableNumber label='Stock' value={only.quantity} onSave={(quantity) => onSave({ warehouses: [{ code: only.code, quantity }] })} />
}
