/*
 * One event, opened from the Events log: which way it went, what it carried, and the
 * ids that tie it to the other systems.
 *
 * The id worth copying is the delivered event's own id: I/O Events shows it on a
 * registration's Debug Tracing page, which is where to look for what Commerce sent.
 * Adobe documents no link to a single event there, so this page shows the id rather
 * than pretending to link to it.
 */
import React from 'react'
import { ActionButton, Heading, Text, View, Flex, StatusLight } from '@adobe/react-spectrum'
import ChevronLeft from '@spectrum-icons/workflow/ChevronLeft'
import { formatStamp } from '../formatStamp'

function Field ({ label, children }) {
  return (
    <Flex direction='column' marginBottom='size-200'>
      <Text UNSAFE_className='erp-field-label'>{label}</Text>
      <Text>{children}</Text>
    </Flex>
  )
}

export default function EventDetail ({ entry, state, onBack }) {
  const incoming = entry.direction === 'in'
  return (
    <>
      <ActionButton isQuiet onPress={onBack} marginBottom='size-150'>
        <ChevronLeft />
        <Text>Events</Text>
      </ActionButton>
      <Heading level={2} marginTop={0}>{entry.event}</Heading>
      <Field label='Direction'>{incoming ? '← From Commerce' : '→ To Commerce'}</Field>
      {/* The exact time too: it is what Debug Tracing lists deliveries by. */}
      <Field label='When'>{formatStamp(entry.at)} ({entry.at})</Field>
      <Field label='Status'><StatusLight variant={state.variant}>{state.text}</StatusLight></Field>
      {incoming && <Field label='What the ERP did'>{entry.summary}</Field>}
      {!incoming && entry.lastError && <Field label='Last error'>{entry.lastError}</Field>}
      <Field label={incoming ? 'I/O Events id (find it on the registration\'s Debug Tracing)' : 'Sent as uid'}>
        {incoming ? (entry.eventId || 'not passed on by this version of the integration') : entry._id}
      </Field>
      <Field label='Journal entry'>{entry._id}</Field>
      <Text UNSAFE_className='erp-field-label'>Payload</Text>
      <View backgroundColor='gray-100' borderRadius='regular' padding='size-150' marginTop='size-50' overflow='auto'>
        <pre style={{ margin: 0, fontSize: '12px', whiteSpace: 'pre-wrap' }}>{JSON.stringify(entry.value, null, 2)}</pre>
      </View>
    </>
  )
}
