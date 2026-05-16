import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import s from './Card.module.css'
import { useSizing } from '../state/SizingContext.jsx'
import { queryMonitoring } from '../lib/api.js'

const EASE = [0.4, 0, 0.2, 1]
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAYS_BUSINESS = [0, 1, 2, 3, 4]   // Mon–Fri
const HOUR_BUSINESS_START = 9
const HOUR_BUSINESS_END = 17

/**
 * One card for one estimator field that's derived from a Cloud Monitoring query.
 * `field` selects which value the card displays:
 *   - "a1" → "Percentage of queries using >200K context window"
 *   - "a2" → "Estimated queries per second requiring assurance"
 *
 * Both cards share the same monitoring config (project_id, window_days, time
 * filter) via SizingContext so the user only enters them once. Either card's
 * "Estimate" button calls /api/monitoring/query and updates BOTH cards' values
 * (the response carries both A1 and A2).
 */
const META = {
  a1: {
    title: 'Percentage of queries using >200K context window',
    desc: 'Run a Cloud Monitoring query to derive what fraction of recent traffic landed in input-token buckets at or above 200K.',
    avgKey: 'a1_pct_over_200k',
    peakKey: 'a1_pct_peak',
    peakTsKey: 'peak_bucket_ts_pct',
    unit: '%',
    format: (v) => v.toFixed(2),
  },
  a2: {
    title: 'Estimated queries per second requiring assurance',
    desc: 'Run a Cloud Monitoring query to derive the average request rate. Optionally restrict to specific days/hours so peak-traffic windows aren\'t diluted.',
    avgKey: 'a2_qps',
    peakKey: 'a2_qps_peak',
    peakTsKey: 'peak_bucket_ts_qps',
    unit: 'qps',
    format: (v) => v.toFixed(4),
  },
}


function CopyMini({ value }) {
  const [copied, setCopied] = useState(false)
  async function go() {
    if (value == null) return
    try {
      await navigator.clipboard.writeText(String(value))
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch { /* clipboard blocked */ }
  }
  return (
    <button
      type="button"
      className={`${s.miniCopy} ${copied ? s.miniCopied : ''}`}
      onClick={go}
      disabled={value == null}
    >{copied ? '✓' : 'copy'}</button>
  )
}

function DayChips({ value, onChange }) {
  function toggle(day) {
    const has = value.includes(day)
    onChange(has ? value.filter(d => d !== day) : [...value, day].sort())
  }
  return (
    <div className={s.dayChips}>
      {DAY_LABELS.map((label, i) => {
        const on = value.includes(i)
        return (
          <button
            key={label}
            type="button"
            className={`${s.dayChip} ${on ? s.dayChipOn : ''}`}
            onClick={() => toggle(i)}
            aria-pressed={on}
          >{label}</button>
        )
      })}
    </div>
  )
}

export default function MonitoringFieldCard({ field }) {
  const sizing = useSizing()
  const meta = META[field]
  const setter = field === 'a1' ? sizing.setA1 : sizing.setA2
  const state  = field === 'a1' ? sizing.a1   : sizing.a2

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const ready = state.value != null
  const { projectId, windowDays, daysOfWeek, hourStart, hourEnd, timezone } = sizing.monitoring

  function patch(p) { sizing.setMonitoring(m => ({ ...m, ...p })) }
  function setProjectId(v)  { patch({ projectId: v }) }
  function setWindowDays(v) { patch({ windowDays: v }) }
  function setDaysOfWeek(v) { patch({ daysOfWeek: v }) }
  function setHourStart(v)  { patch({ hourStart: v }) }
  function setHourEnd(v)    { patch({ hourEnd: v }) }
  function resetFilter() {
    patch({
      daysOfWeek: DAYS_BUSINESS,
      hourStart: HOUR_BUSINESS_START,
      hourEnd: HOUR_BUSINESS_END,
    })
  }

  const filterActive =
    (daysOfWeek?.length ?? 0) > 0 && daysOfWeek.length < 7
    || (hourStart !== hourEnd && !(hourStart === 0 && hourEnd === 24))

  async function run() {
    if (!projectId.trim()) return
    setLoading(true); setError(null)
    try {
      const r = await queryMonitoring({
        projectId: projectId.trim(),
        model: sizing.model,
        windowDays,
        daysOfWeek,
        hourStart,
        hourEnd,
        timezone,
      })
      // The response carries BOTH a1 and a2 — populate both cards from one call.
      sizing.setA1({
        value: r.a1_pct_over_200k,
        peak: r.a1_pct_peak,
        diag: r.diagnostics,
        queries: r.queries,
        windowDays: r.window_days,
        filter: r.filter_applied,
      })
      sizing.setA2({
        value: r.a2_qps,
        peak: r.a2_qps_peak,
        diag: r.diagnostics,
        queries: r.queries,
        windowDays: r.window_days,
        filter: r.filter_applied,
      })
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const peakValue = state.peak != null ? state.peak : null
  const peakTs = state.diag?.[meta.peakTsKey] ?? null
  const matched = state.diag?.matched_buckets
  const totalBuckets = state.diag?.total_buckets

  return (
    <div className={`${s.card} ${ready ? s.ready : ''}`}>
      <div className={s.head}>
        <div className={s.label}>
          <div className={s.title}>{meta.title}</div>
          <div className={s.desc}>{meta.desc}</div>
        </div>
        <div className={`${s.statusPill} ${ready ? s.set : ''}`}>
          <span className={s.dot} />
          {ready ? `${meta.format(state.value)}${meta.unit ? ' ' + meta.unit : ''}` : 'Not estimated'}
        </div>
      </div>
      <div className={s.body}>
        <div className={s.formRow}>
          <div className={s.field}>
            <label className={s.fieldLabel} htmlFor={`proj-${field}`}>GCP Project ID</label>
            <input
              id={`proj-${field}`}
              className={s.input}
              type="text"
              placeholder="my-customer-project"
              value={projectId}
              onChange={e => setProjectId(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className={s.field}>
            <label className={s.fieldLabel} htmlFor={`win-${field}`}>Window (days)</label>
            <input
              id={`win-${field}`}
              className={s.input}
              type="number"
              min={1} max={90}
              value={windowDays}
              onChange={e => setWindowDays(Number(e.target.value) || 7)}
            />
          </div>
          <button
            type="button"
            className={`btn btn-primary ${s.actionBtn}`}
            onClick={run}
            disabled={loading || !projectId.trim()}
          >
            {loading ? 'Estimating…' : ready ? '↻ Re-estimate' : 'Estimate'}
          </button>
        </div>

        <p className={s.windowHint}>
          Pick a period that reflects typical traffic — account for seasonality and growth.
        </p>

        <details className={s.filterDetails} open={filterActive}>
          <summary className={s.filterSummary}>
            Time-of-day filter
            <span className={s.filterStatus}>
              {filterActive
                ? `active · ${daysOfWeek.length} day${daysOfWeek.length === 1 ? '' : 's'} · ${hourStart}:00–${hourEnd}:00`
                : '24×7 (no filter)'}
            </span>
          </summary>
          <div className={s.filterBody}>
            <div className={s.filterCaution}>
              <strong>Tip:</strong> pick days/hours that mirror the workload you're sizing for.
              A 24×7 average will under-size a peak-hours-only workload, and a narrow window
              can over-size if it captures an unusual day. Consider seasonality and projected growth.
            </div>
            <div className={s.filterRow}>
              <span className={s.filterRowLabel}>Days</span>
              <DayChips value={daysOfWeek} onChange={setDaysOfWeek} />
            </div>
            <div className={s.filterRow}>
              <span className={s.filterRowLabel}>Hours</span>
              <div className={s.hourRange}>
                <input
                  type="number" min={0} max={24}
                  className={s.hourInput}
                  value={hourStart}
                  onChange={e => setHourStart(Math.max(0, Math.min(24, Number(e.target.value) || 0)))}
                />
                <span className={s.hourSep}>to</span>
                <input
                  type="number" min={0} max={24}
                  className={s.hourInput}
                  value={hourEnd}
                  onChange={e => setHourEnd(Math.max(0, Math.min(24, Number(e.target.value) || 0)))}
                />
                <span className={s.tzLabel} title="Browser timezone — buckets are matched in this TZ">
                  {timezone}
                </span>
              </div>
            </div>
            <div className={s.filterFoot}>
              <span className={s.filterHint}>
                {(daysOfWeek?.length ?? 0) === 0 && 'No days selected — query will treat as all days. '}
                Hours are 24-hour, end is exclusive (e.g. 8–22 = 8:00 through 21:59).
              </span>
              <button type="button" className={s.filterReset} onClick={resetFilter}>
                Reset to business hours (Mon–Fri 9–17)
              </button>
            </div>
          </div>
        </details>

        <AnimatePresence>
          {error && (
            <motion.div
              key="err"
              className={s.error}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >! {error}</motion.div>
          )}
        </AnimatePresence>

        {ready && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: EASE }}
          >
            <div className={s.avgPeakGrid}>
              <div className={`${s.resultBox} ${s.set}`}>
                <div className={s.resultBoxHead}>
                  <span className={s.resultBoxLabel}>Average</span>
                  <CopyMini value={meta.format(state.value)} />
                </div>
                <div className={s.resultValue}>
                  {meta.format(state.value)}<span className={s.unit}>{meta.unit}</span>
                </div>
                <div className={s.resultDiag}>
                  {matched != null && totalBuckets != null
                    ? `${matched.toLocaleString()} of ${totalBuckets.toLocaleString()} 5-min buckets matched`
                    : `over ${state.windowDays ?? windowDays}d`}
                </div>
              </div>

              <div className={`${s.resultBox} ${peakValue != null ? s.peak : ''}`}>
                <div className={s.resultBoxHead}>
                  <span className={s.resultBoxLabel}>Peak (5-min)</span>
                  <CopyMini value={peakValue != null ? meta.format(peakValue) : null} />
                </div>
                <div className={s.resultValue}>
                  {peakValue != null
                    ? <>{meta.format(peakValue)}<span className={s.unit}>{meta.unit}</span></>
                    : <span className={s.empty}>—</span>}
                </div>
                <div className={s.resultDiag}>
                  {peakTs ? `at ${peakTs}` : 'no matched buckets'}
                </div>
              </div>
            </div>

            <div className={s.avgPeakNote}>
              <strong>Avg</strong> reflects sustained load — size to this if some throttling at peaks is acceptable.
              {' '}<strong>Peak</strong> is the worst 5-minute slice in the matched window — size to this for full coverage at the cost of more idle GSU.
              The right answer is usually somewhere between, based on your tolerance for overflow.
            </div>

            {state.queries && (
              <details className={s.queries}>
                <summary>Show MQL body</summary>
                <pre className={s.queryBlock} style={{ marginTop: 8 }}>
                  {state.queries[field]}
                </pre>
              </details>
            )}
          </motion.div>
        )}
      </div>
    </div>
  )
}
