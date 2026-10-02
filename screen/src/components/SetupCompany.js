/*
 * Settings → Company, as Business Central's Company Information: the company printed as the
 * seller on every invoice, its code, and the currency the ERP shows money in (lib/setup.js).
 */
import React from 'react'
import { Grid, Text, TextArea, TextField, Flex } from '@adobe/react-spectrum'
import SetupCard from './SetupCard'
import Field from './Field'
import { addressLines } from './setupFormat'

const COLUMNS = { base: ['1fr'], M: ['1fr', '1fr'] }

/** The address as lines, or a dash. */
function AddressValue ({ address }) {
  const lines = addressLines(address)
  if (lines.length === 0) return <Text>—</Text>
  return <Flex direction='column'>{lines.map((line) => <Text key={line}>{line}</Text>)}</Flex>
}

function view (company) {
  return (
    <Grid columns={COLUMNS} gap='size-250'>
      <Field label='Name'>{company.name}</Field>
      <Field label='Company code'>{company.code}</Field>
      <Field label='Address'><AddressValue address={company.address} /></Field>
      <Field label='Tax ID'>{company.taxId || '—'}</Field>
      <Field label='Currency'>{company.currency || '—'}</Field>
    </Grid>
  )
}

/** The draft as the form edits it: the address flattened into its fields. */
function draftOf (company) {
  const a = company.address || {}
  return {
    name: company.name || '',
    code: company.code || '',
    street: (a.street || []).join('\n'),
    city: a.city || '',
    region: a.region || '',
    postcode: a.postcode || '',
    countryId: a.countryId || '',
    taxId: company.taxId || '',
    currency: company.currency || ''
  }
}

/** The draft as the ERP takes it. */
function patchOf (draft) {
  const { street, city, region, postcode, countryId, ...rest } = draft
  return { ...rest, address: { street: street.split('\n'), city, region, postcode, countryId } }
}

function form (draft, setDraft) {
  const set = (key) => (value) => setDraft({ ...draft, [key]: value })
  return (
    <Grid columns={COLUMNS} columnGap='size-250'>
      <TextField label='Name' width='100%' value={draft.name} onChange={set('name')} isRequired description='Printed as the seller on invoices.' />
      <TextField label='Company code' width='100%' value={draft.code} onChange={set('code')} isRequired description='1 to 4 letters or digits.' />
      <TextArea label='Street' width='100%' value={draft.street} onChange={set('street')} />
      <TextField label='City' width='100%' value={draft.city} onChange={set('city')} />
      <TextField label='Region' width='100%' value={draft.region} onChange={set('region')} />
      <TextField label='Postal code' width='100%' value={draft.postcode} onChange={set('postcode')} />
      <TextField label='Country' width='100%' value={draft.countryId} onChange={set('countryId')} description='Two letters, such as US.' />
      <TextField label='Tax ID' width='100%' value={draft.taxId} onChange={set('taxId')} />
      <TextField label='Currency' width='100%' value={draft.currency} onChange={set('currency')} isRequired description='Money with no currency of its own is shown in it.' />
    </Grid>
  )
}

export default function SetupCompany ({ company, onSave }) {
  return (
    <SetupCard
      title='Company'
      value={draftOf(company)}
      onSave={(draft) => onSave({ company: patchOf(draft) })}
      view={() => view(company)}
      form={form}
    />
  )
}
