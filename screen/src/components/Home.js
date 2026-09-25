/*
 * Home: the work list. What is waiting for someone in this ERP, each cue a count and a
 * way into the list it counts, filtered to exactly those rows. Fiori calls this an
 * overview page and Business Central a Role Center; SAP's credit guidance describes the
 * surface as "overview lists of the blocked orders and deliveries" (plan §3.1).
 *
 * Counts of records are not work and are not here — the ERP's size is on Settings. No
 * charts, no revenue-this-month (it cannot be computed honestly), no greeting (there are
 * no users). Sync and Wipe stay on Settings: this is not a control panel.
 */
import React from 'react'
import { Flex, Heading, Text } from '@adobe/react-spectrum'
import Frame from './Frame'
import Card from './Card'
import { CUES } from '../../../lib/cues'
import { formatStamp } from '../formatStamp'
import { money } from '../money'

/** A cue: the number, its name, and the filtered list it opens. Hidden when nothing waits. */
function Cue ({ cue, count, onOpen }) {
  return (
    <button type='button' className='erp-cue' onClick={() => onOpen(cue.list, { work: cue.filter })} aria-label={`${cue.label}: ${count}`}>
      <span className='erp-cue-count'>{count}</span>
      <span className='erp-cue-label'>{cue.label}</span>
    </button>
  )
}

/* The cues that mean something only once there are company accounts (plan §3.1 marks them
   M): with no credit relationship there is nothing to hold or to block. */
const NEEDS_ACCOUNTS = new Set(['onHold', 'blockedCustomers'])

export default function Home ({ health, reloading, onNavigate }) {
  const work = (health && health.work) || null
  const counts = (work && work.counts) || {}
  const hasAccounts = Boolean(health && health.counts && health.counts.businessPartners > 1)
  const cues = CUES.filter((cue) => hasAccounts || !NEEDS_ACCOUNTS.has(cue.key))
  const open = (list, query) => onNavigate(list, query)

  return (
    <Frame title='Home' loading={!health || reloading}>
      {work && (
        <>
          <div className='erp-cues'>
            {cues.map((cue) => <Cue key={cue.key} cue={cue} count={counts[cue.key] ?? 0} onOpen={open} />)}
          </div>
          <Flex gap='size-300' wrap alignItems='start'>
            <div className='erp-home-column'>
              <Card title='Recent documents'>
                {work.recent.length === 0 && <Text UNSAFE_className='erp-subtle'>No documents yet. The first sales order will appear here.</Text>}
                {work.recent.length > 0 && (
                  <ul className='erp-recent'>
                    {work.recent.map((doc) => (
                      <li key={`${doc.kind}:${doc.number}`}>
                        <button type='button' className='erp-link' onClick={() => open(LIST_OF[doc.kind], { open: doc.number })}>
                          <span className='erp-key'>{doc.title}</span>
                        </button>
                        <span className='erp-subtle'> · {formatStamp(doc.at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
            <div className='erp-home-column'>
              <Card title='Open order value'>
                <Heading level={2} marginY='size-50'>{work.openValue.currency ? money(work.openValue.amount, work.openValue.currency) : `${work.openValue.amount} (mixed currencies)`}</Heading>
                <Text UNSAFE_className='erp-subtle'>Net amount of every sales order not yet invoiced or cancelled.</Text>
              </Card>
            </div>
          </Flex>
        </>
      )}
    </Frame>
  )
}

/** Which list page shows each kind of document. */
export const LIST_OF = { order: 'orders', shipment: 'shipments', invoice: 'invoices', product: 'products', customer: 'partners' }
