/*
 * A product's status as a light: in stock, low stock or out of stock, from what is
 * AVAILABLE (on hand less committed, lib/availability), with the same threshold the ERP
 * uses (lib/stock-status). A product blocked for sales says so instead — that is the
 * status a person needs to see first, whatever is on the shelf.
 */
import React from 'react'
import { StatusLight } from '@adobe/react-spectrum'
import { stockStatus } from '../../../lib/stock-status'

const TINTS = {
  in: ['positive', 'In stock'],
  low: ['notice', 'Low stock'],
  out: ['negative', 'Out of stock']
}

/**
 * @param {{ available?: number, quantity?: number, salesStatus?: string }} props
 *   `available` when the caller has it; `quantity` for a single warehouse row
 */
export default function StockStatus ({ available, quantity, salesStatus }) {
  if (salesStatus === 'blocked') return <StatusLight variant='negative'>Blocked for sales</StatusLight>
  const [variant, text] = TINTS[stockStatus(available !== undefined ? available : quantity)]
  return <StatusLight variant={variant}>{text}</StatusLight>
}
