import { useNavigate } from 'react-router-dom'
import { motion } from 'motion/react'
import s from './SizingPage.module.css'
import { useSizing } from '../state/SizingContext.jsx'
import MonitoringFieldCard from '../components/MonitoringFieldCard.jsx'
import TokenCard from '../components/TokenCard.jsx'

const EASE = [0.4, 0, 0.2, 1]
const TOTAL_FIELDS = 6

function TocItem({ label, value, unit, targetId }) {
  const set = value != null
  function jumpTo() {
    const el = document.getElementById(targetId)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  function onKey(e) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jumpTo() }
  }
  return (
    <div
      className={`${s.tocItem} ${set ? s.tocSet : s.tocUnset}`}
      onClick={jumpTo}
      role="button"
      tabIndex={0}
      onKeyDown={onKey}
      aria-label={`Jump to ${label}`}
    >
      <span
        className={`${s.tocBadge} ${set ? s.tocBadgeSet : s.tocBadgeEmpty}`}
        aria-hidden
      >{set ? '✓' : ''}</span>
      <span className={s.tocLabel}>{label}</span>
      <span className={s.tocValue}>
        {set
          ? <>{Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2)}<span className={s.tocUnit}>{unit}</span></>
          : <span className={s.tocEmpty}>—</span>}
      </span>
      <span className={s.tocJump} aria-hidden>↓</span>
    </div>
  )
}

export default function SizingPage() {
  const navigate = useNavigate()
  const { a1, a2, a3, a4, a5, a6 } = useSizing()

  const filled = [
    a1.value != null, a2.value != null, a3.value != null,
    a4.value != null, a5.value != null, a6.value != null,
  ].filter(Boolean).length
  const allReady = filled === TOTAL_FIELDS

  return (
    <div className={s.page}>
      <div className="page">
        <header className={s.intro}>
          <div>
            <div className={s.eyebrow}>Step 01 · Sizing inputs</div>
            <h1 className={s.title}>Populate the six estimator fields.</h1>
            <p className={s.subtitle}>
              Each field has its own action — pull from monitoring or estimate
              from a sample. Use the contents below to jump to a specific field,
              then continue to the summary when you're done.
            </p>
          </div>
          <div className={`${s.summaryCounter} ${allReady ? s.complete : ''}`}>
            {filled} of {TOTAL_FIELDS} inputs ready
          </div>
        </header>

        <motion.nav
          className={s.toc}
          aria-label="Sizing inputs contents"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE, delay: 0.05 }}
        >
          <div className={s.tocHead}>
            <div className={s.tocEyebrow}>Contents</div>
            <div className={s.tocHint}>Click a field to jump to its section</div>
          </div>
          <div className={s.tocList}>
            <TocItem label="Percentage of queries using >200K context window" value={a1.value} unit="%"   targetId="card-a1" />
            <TocItem label="Estimated queries per second requiring assurance" value={a2.value} unit="qps" targetId="card-a2" />
            <TocItem label="Input text tokens per query"                      value={a3.value} unit="tok" targetId="card-input" />
            <TocItem label="Input image tokens per query"                     value={a4.value} unit="tok" targetId="card-input" />
            <TocItem label="Output response text tokens per query"            value={a5.value} unit="tok" targetId="card-a5" />
            <TocItem label="Output image tokens per query"                    value={a6.value} unit="tok" targetId="card-a6" />
          </div>
        </motion.nav>

        <div className={s.cards}>
          <div id="card-a1" className={s.cardAnchor}>
            <MonitoringFieldCard field="a1" />
          </div>
          <div id="card-a2" className={s.cardAnchor}>
            <MonitoringFieldCard field="a2" />
          </div>
          <div id="card-input" className={s.cardAnchor}>
            <TokenCard
              title="Input tokens per query (text + image)"
              desc="Upload one representative input image and/or paste a typical text prompt. One Estimate call fills both the text and image input fields. ⚡ Run Model to est. Outputs additionally populates the output cards below."
              kind="input"
              accept="image/*"
              runEndToEnd
            />
          </div>
          <div id="card-a5" className={s.cardAnchor}>
            <TokenCard
              title="Output response text tokens per query"
              desc="Paste a representative model output text sample, then click Estimate."
              kind="output_text"
            />
          </div>
          <div id="card-a6" className={s.cardAnchor}>
            <TokenCard
              title="Output image tokens per query"
              desc="Upload one representative output image, then click Estimate."
              kind="output_image"
              accept="image/*"
              allowText={false}
            />
          </div>
        </div>

        <motion.section
          className={`${s.footerCta} ${allReady ? s.footerReady : ''}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE }}
        >
          <div className={s.footerCopy}>
            <h2 className={s.footerTitle}>
              {allReady ? 'All six inputs ready.' : 'Continue to the summary.'}
            </h2>
            {allReady && (
              <p className={s.footerSubtitle}>
                Open the summary to copy each value into the Google Cloud PT Estimator.
              </p>
            )}
          </div>
          <button
            type="button"
            className={`btn btn-primary ${s.summaryBtn}`}
            onClick={() => navigate('/summary')}
          >
            View summary <span className={s.arrow}>→</span>
          </button>
        </motion.section>
      </div>
    </div>
  )
}
