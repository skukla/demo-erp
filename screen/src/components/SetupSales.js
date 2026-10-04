/*
 * Settings → Sales & receivables, as Business Central's Sales & Receivables Setup: the
 * payment terms a new customer takes, what a new order's credit check holds it for, and the
 * return reason codes a return line is coded with (lib/setup.js).
 */
import React from 'react'
import {
  ActionButton, Flex, Grid, Item, Picker, Text, TextField,
  TableView, TableHeader, Column, TableBody, Row, Cell
} from '@adobe/react-spectrum'
import SetupCard from './SetupCard'
import Field from './Field'
import { CREDIT_WARNING_OPTIONS, creditWarningText, paymentTermsOptions, paymentTermsText } from './setupFormat'
import { useColumnWidths } from './columnWidths'
import { GRID_COLUMNS } from './gridColumns'

const COLUMNS = { base: ['1fr'], M: ['1fr', '1fr'] }

function ReasonTable ({ reasons }) {
  const widths = useColumnWidths('returnReasons', GRID_COLUMNS.returnReasons)
  return (
    <TableView {...widths.tableProps} aria-label='Return reasons' density='compact' overflowMode='wrap'>
      <TableHeader>
        <Column key='code' {...widths.columnProps('code')}>Code</Column>
        <Column key='description' {...widths.columnProps('description')}>Description</Column>
      </TableHeader>
      <TableBody items={reasons.map((r) => ({ ...r, id: r.code }))}>
        {(r) => (
          <Row key={r.code}>
            <Cell><span className='erp-key'>{r.code}</span></Cell>
            <Cell>{r.description}</Cell>
          </Row>
        )}
      </TableBody>
    </TableView>
  )
}

function view (sales) {
  const fallback = sales.returnReasons.find((r) => r.code === sales.defaultReturnReason)
  return (
    <Flex direction='column' gap='size-250'>
      <Grid columns={COLUMNS} gap='size-250'>
        <Field label='Default payment terms'>{paymentTermsText(sales.defaultPaymentTerms)}</Field>
        <Field label='Credit warnings'>{creditWarningText(sales.creditWarnings)}</Field>
        <Field label='Default return reason'>{fallback ? `${fallback.code} · ${fallback.description}` : sales.defaultReturnReason}</Field>
      </Grid>
      <Flex direction='column' gap='size-50'>
        <Text UNSAFE_className='erp-field-label'>Return reasons</Text>
        <ReasonTable reasons={sales.returnReasons} />
      </Flex>
    </Flex>
  )
}

/** The return reasons as rows of fields; a row's key is its place, since its code is being typed. */
function ReasonRows ({ reasons, onChange }) {
  const change = (at, key, value) => onChange(reasons.map((r, i) => (i === at ? { ...r, [key]: value } : r)))
  return (
    <Flex direction='column' gap='size-100'>
      {reasons.map((r, at) => (
        // eslint-disable-next-line react/no-array-index-key -- the code is what is being edited
        <Flex key={at} gap='size-150' alignItems='end'>
          <TextField aria-label={`Return reason ${at + 1} code`} value={r.code} onChange={(v) => change(at, 'code', v)} width='size-1600' />
          <TextField aria-label={`Return reason ${at + 1} description`} value={r.description} onChange={(v) => change(at, 'description', v)} flexGrow={1} />
          <ActionButton isQuiet onPress={() => onChange(reasons.filter((_, i) => i !== at))}>Remove</ActionButton>
        </Flex>
      ))}
      <ActionButton alignSelf='start' onPress={() => onChange([...reasons, { code: '', description: '' }])}>Add reason</ActionButton>
    </Flex>
  )
}

function form (draft, setDraft) {
  const set = (key) => (value) => setDraft({ ...draft, [key]: value })
  return (
    <Flex direction='column' gap='size-250'>
      <Grid columns={COLUMNS} columnGap='size-250'>
        <Picker label='Default payment terms' width='100%' items={paymentTermsOptions(draft.defaultPaymentTerms)} selectedKey={draft.defaultPaymentTerms} onSelectionChange={set('defaultPaymentTerms')} description='Taken by a customer the ERP creates.'>
          {(o) => <Item key={o.id}>{o.name}</Item>}
        </Picker>
        <Picker label='Credit warnings' width='100%' items={CREDIT_WARNING_OPTIONS} selectedKey={draft.creditWarnings} onSelectionChange={set('creditWarnings')} description='What holds a new order for credit.'>
          {(o) => <Item key={o.id}>{o.name}</Item>}
        </Picker>
      </Grid>
      {/* A row of its own: a reason reads "RETURN · Customer return", and in half the card it
          was cut at a 1,280 px window (2026-10-04). */}
      <Picker label='Default return reason' width='100%' items={draft.returnReasons.filter((r) => r.code).map((r) => ({ id: r.code, name: `${r.code} · ${r.description}` }))} selectedKey={draft.defaultReturnReason} onSelectionChange={set('defaultReturnReason')} description='For a return line whose reason matches none.'>
        {(o) => <Item key={o.id}>{o.name}</Item>}
      </Picker>
      <Flex direction='column' gap='size-50'>
        <Text UNSAFE_className='erp-field-label'>Return reasons</Text>
        <ReasonRows reasons={draft.returnReasons} onChange={set('returnReasons')} />
      </Flex>
    </Flex>
  )
}

export default function SetupSales ({ sales, onSave }) {
  return (
    <SetupCard
      title='Sales & Receivables'
      value={sales}
      onSave={(draft) => onSave({ sales: draft })}
      view={() => view(sales)}
      form={form}
    />
  )
}
