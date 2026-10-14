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
 * @param {{ available?: number, quantity?: number, salesStatus?: string, prominent?: boolean }} props
 *   `available` when the caller has it; `quantity` for a single warehouse row;
 *   `prominent` for the record's own status beside its title
 */
export default function StockStatus ({ available, quantity, salesStatus, prominent }) {
  const className = prominent ? 'erp-status-title' : undefined
  if (salesStatus === 'blocked') {
    return <StatusLight variant='negative' UNSAFE_className={className}>Blocked for sales</StatusLight>
  }
  if (salesStatus === 'discontinued') {
    return <StatusLight variant='neutral' UNSAFE_className={className}>Discontinued</StatusLight>
  }
  const [variant, text] = TINTS[stockStatus(available !== undefined ? available : quantity)]
  return <StatusLight variant={variant} UNSAFE_className={className}>{text}</StatusLight>
}
