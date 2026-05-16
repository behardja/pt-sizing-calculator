import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'motion/react'
import s from './SummaryPage.module.css'
import { useSizing, estimatorUrlFor } from '../state/SizingContext.jsx'

const EASE = [0.4, 0, 0.2, 1]

function formatValue(value) {
  if (value == null) return ''
  if (Number.isInteger(value)) return String(value)
  return Number(value.toFixed(4)).toString()
}

function displayValue(value) {
  if (value == null) return ''
  if (Number.isInteger(value)) return value.toLocaleString()
  return value.toFixed(2)
}

function RowCopyButton({ value }) {
  const [copied, setCopied] = useState(false)
  async function go() {
    try {
      await navigator.clipboard.writeText(formatValue(value))
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      // clipboard blocked
    }
  }
  return (
    <button
      type="button"
      className={`${s.rowCopy} ${copied ? s.rowCopied : ''}`}
      onClick={go}
      aria-label="Copy value"
    >
      {copied ? '✓ copied' : 'copy'}
    </button>
  )
}

export default function SummaryPage() {
  const navigate = useNavigate()
  const { model, a1, a2, a3, a4, a5 } = useSizing()

  const rows = [
    { key: 'a1', label: 'Percentage of queries using >200K context window', unit: '%',   value: a1.value },
    { key: 'a2', label: 'Estimated queries per second requiring assurance', unit: 'qps', value: a2.value },
    { key: 'a3', label: 'Input tokens (image + text) per query',            unit: 'tok', value: a3.value },
    { key: 'a4', label: 'Output response text tokens per query',            unit: 'tok', value: a4.value },
    { key: 'a5', label: 'Output image tokens per query',                    unit: 'tok', value: a5.value },
  ]

  const filled = rows.filter(r => r.value != null).length
  const allReady = filled === rows.length

  function openCalculator() {
    window.open(estimatorUrlFor(model), '_blank', 'noopener,noreferrer')
  }

  return (
    <div className={s.page}>
      <div className="page">
        <header className={s.intro}>
          <div>
            <div className={s.eyebrow}>Step 02 · Summary</div>
            <h1 className={s.title}>All sizing inputs in one table.</h1>
            <p className={s.subtitle}>
              Copy each value into the Google Cloud PT Estimator. Fields you
              haven't filled yet appear blank — return to Step 01 to populate them.
            </p>
          </div>
          <div className={`${s.counter} ${allReady ? s.complete : ''}`}>
            {filled} of {rows.length} populated
          </div>
        </header>

        <motion.section
          className={s.tableWrap}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE }}
        >
          <div className={s.tableHead}>
            <h2 className={s.tableTitle}>Sizing inputs</h2>
            <span className={s.tableHint}>
              Use each row's copy button to paste the value into the estimator.
            </span>
          </div>

          <div className={s.tableScroll}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th className={s.colField}>Field</th>
                  <th className={s.colValue}>Value</th>
                  <th className={s.colUnit}>Unit</th>
                  <th className={s.colCopy} aria-label="Copy" />
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const set = r.value != null
                  return (
                    <tr key={r.key} className={set ? s.rowSet : s.rowEmpty}>
                      <td className={s.colField}>{r.label}</td>
                      <td className={s.colValue}>
                        {set ? (
                          <span className={s.value}>{displayValue(r.value)}</span>
                        ) : (
                          <span className={s.blank} aria-label="not yet populated" />
                        )}
                      </td>
                      <td className={s.colUnit}>
                        {set ? <span className={s.unit}>{r.unit}</span> : null}
                      </td>
                      <td className={s.colCopy}>
                        {set ? <RowCopyButton value={r.value} /> : null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </motion.section>

        <div className={s.actions}>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => navigate('/')}
          >
            ← Back to inputs
          </button>
          <button
            type="button"
            className={`btn btn-primary ${s.openBtn}`}
            onClick={openCalculator}
          >
            Open Google Cloud PT Estimator <span className={s.arrow}>↗</span>
          </button>
          <span className={s.note}>
            {allReady
              ? 'Copy each value and paste it into the matching estimator field.'
              : `${rows.length - filled} field${rows.length - filled === 1 ? '' : 's'} still blank — copy what you have, or return to Step 01.`}
          </span>
        </div>
      </div>
    </div>
  )
}
