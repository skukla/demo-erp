/*
 * Product table cells that edit in place: price, and stock when one warehouse
 * holds it. A configurable product's price and stock belong to its variants, and
 * stock spread over several warehouses is changed on the product's page, which
 * says where.
 */
import React from 'react'
import EditableNumber from './EditableNumber'
import { priceText } from './productFormat'

const MONEY = { style: 'currency', currency: 'USD' }

export function PriceCell ({ product, onSave }) {
  if (product.type === 'configurable') return priceText(product)
  return <EditableNumber label='Price' value={product.listPrice} step={0.01} formatOptions={MONEY} onSave={(listPrice) => onSave({ listPrice })} />
}

export function StockCell ({ product, onSave }) {
  const warehouses = product.warehouses || []
  if (product.type === 'configurable' || warehouses.length !== 1) return product.stock
  const [only] = warehouses
  return <EditableNumber label='Stock' value={only.quantity} onSave={(quantity) => onSave({ warehouses: [{ code: only.code, quantity }] })} />
}
