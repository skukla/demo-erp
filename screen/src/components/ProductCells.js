/*
 * Product table cells that edit in place while their table is in edit mode: name,
 * price, and stock when one warehouse holds it. A configurable product's price and
 * stock belong to its variants, and stock spread over several warehouses is changed on
 * the product's page, which says where. A cell being saved shows a spinner.
 */
import React from 'react'
import EditableNumber from './EditableNumber'
import EditableText from './EditableText'
import SavingValue from './SavingValue'
import { priceText } from './productFormat'

const MONEY = { style: 'currency', currency: 'USD' }

export function NameCell ({ product, editing, onSave }) {
  const isSaving = product.saving === 'name'
  if (!editing) return <SavingValue isSaving={isSaving}>{product.name}</SavingValue>
  return <EditableText label='Name' value={product.name} isSaving={isSaving} onSave={(name) => onSave({ name })} />
}

export function PriceCell ({ product, editing, onSave }) {
  const isSaving = product.saving === 'listPrice'
  if (!editing || product.type === 'configurable') return <SavingValue isSaving={isSaving}>{priceText(product)}</SavingValue>
  return <EditableNumber label='Price' value={product.listPrice} step={0.01} formatOptions={MONEY} isSaving={isSaving} onSave={(listPrice) => onSave({ listPrice })} />
}

export function StockCell ({ product, editing, onSave }) {
  const isSaving = product.saving === 'stock'
  const warehouses = product.warehouses || []
  if (!editing || product.type === 'configurable' || warehouses.length !== 1) {
    return <SavingValue isSaving={isSaving}>{product.stock}</SavingValue>
  }
  const [only] = warehouses
  return <EditableNumber label='Stock' value={only.quantity} isSaving={isSaving} onSave={(quantity) => onSave({ warehouses: [{ code: only.code, quantity }] })} />
}
