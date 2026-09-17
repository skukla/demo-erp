/* In stock or out of stock, as a status light. */
import React from 'react'
import { StatusLight } from '@adobe/react-spectrum'

export default function StockStatus ({ quantity }) {
  return quantity > 0
    ? <StatusLight variant='positive'>In stock</StatusLight>
    : <StatusLight variant='negative'>Out of stock</StatusLight>
}
