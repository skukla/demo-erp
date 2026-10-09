/*
 * The process flow strip at the top of a document: its stages in order, a marker for each
 * joined by a line, and — only when the next move is made on another document and has no
 * button on this page (orderFlow.js says which) — one link underneath that opens it. SAP Fiori calls it the process flow; it is how an ERP shows
 * that an order goes through more steps than its one status word says.
 *
 * Which stages, and where the document stands, is orderFlow.js (pure, tested without a
 * browser). This draws what it answers: an ordered list, the stage the document stands at
 * marked `aria-current="step"`, and each stage's state said three ways — a mark, a word for
 * a screen reader, and a colour — so no one of them carries it alone.
 *
 * A stage that became a document opens it from its own name. The actions stay on the title
 * line: when the next move is one of them there is no line under the strip at all (the
 * button is right above); the line appears only to take the reader to the document the
 * move is made on, by the same `onOpen` the stage names use.
 */
import React from 'react'
import { formatDate } from '../formatStamp'

/* What each state is called aloud. */
const STATE_WORDS = { done: 'Done', current: 'In progress', upcoming: 'Not started', attention: 'Needs attention', stopped: 'Stopped' }

/* What a stage's document is called when its name offers to open it. */
const DOC_WORDS = { shipment: 'shipment', invoice: 'invoice', payment: 'payment', return: 'return order', creditMemo: 'credit memo' }

/* The marks, drawn in currentColor like the ERP's own logo (Logo.js), so each takes the
   colour its state gives the marker. A stage not yet reached carries no mark. */
const MARKS = {
  done: <path d='M4 8.5l2.75 2.75L12 5.5' />,
  current: <circle cx='8' cy='8' r='3' fill='currentColor' stroke='none' />,
  attention: <path d='M8 3.75v5M8 11.75v.5' />,
  stopped: <path d='M5 5l6 6M11 5l-6 6' />
}

function Marker ({ state }) {
  return (
    <span className='erp-flow-marker' role='img' aria-label={STATE_WORDS[state]}>
      {MARKS[state] && (
        <svg viewBox='0 0 16 16' width='16' height='16' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
          {MARKS[state]}
        </svg>
      )}
    </span>
  )
}

/** The stage's name: text, or the way into its document when it has one. */
function StageName ({ stage, onOpen }) {
  if (!stage.doc || !onOpen) return <span className='erp-flow-label'>{stage.label}</span>
  const offer = `open ${DOC_WORDS[stage.doc.kind] || 'document'} ${stage.doc.number}`
  return (
    <button
      type='button'
      className='erp-link erp-flow-label'
      title={`${offer[0].toUpperCase()}${offer.slice(1)}`}
      aria-label={`${stage.label}: ${offer}`}
      onClick={() => onOpen(stage.doc.kind, stage.doc.number)}
    >
      {stage.label}
    </button>
  )
}

/** The line under the strip: the next move, as a link to the document it is made on. */
function NextMove ({ hint, onOpen }) {
  if (!hint || !onOpen) return null
  const offer = `open ${DOC_WORDS[hint.doc.kind] || 'document'} ${hint.doc.number}`
  return (
    <p className='erp-flow-next'>
      <button type='button' className='erp-link' title={`${offer[0].toUpperCase()}${offer.slice(1)}`} onClick={() => onOpen(hint.doc.kind, hint.doc.number)}>
        {hint.text}
      </button>
    </p>
  )
}

/**
 * @param {object} props `flow` is what orderFlow.js answers (`{ stages, nextHint }`, the
 *   hint `{ text, doc }` or null); `onOpen(kind, number)` opens a document on the same trail
 */
export default function ProcessFlow ({ flow, onOpen }) {
  return (
    <div className='erp-flow'>
      <ol className='erp-flow-stages' aria-label='Process flow'>
        {flow.stages.map((stage) => {
          const standing = stage.state === 'current' || stage.state === 'attention'
          // Each fact stays whole: a narrow stage breaks between them, never inside a date or an amount.
          const facts = [stage.date && formatDate(stage.date), ...(stage.detail ? stage.detail.split(' · ') : [])].filter(Boolean)
          return (
            <li key={stage.key} className={`erp-flow-stage erp-flow-${stage.state}`} aria-current={standing ? 'step' : undefined}>
              <Marker state={stage.state} />
              <StageName stage={stage} onOpen={onOpen} />
              {facts.length > 0 && (
                <span className='erp-flow-detail'>
                  {facts.map((fact, i) => <span key={fact} className='erp-flow-fact'>{i < facts.length - 1 ? `${fact} · ` : fact}</span>)}
                </span>
              )}
            </li>
          )
        })}
      </ol>
      <NextMove hint={flow.nextHint} onOpen={onOpen} />
    </div>
  )
}
