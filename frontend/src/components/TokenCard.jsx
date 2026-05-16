import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import s from './Card.module.css'
import { useSizing } from '../state/SizingContext.jsx'
import { countTokens, runAndCount } from '../lib/api.js'

const EASE = [0.4, 0, 0.2, 1]

const KIND_TO_KEY = {
  input: 'a3',
  output_text: 'a4',
  output_image: 'a5',
}

export default function TokenCard({ title, desc, kind, accept, allowText = true, runEndToEnd = false }) {
  const sizing = useSizing()
  const stateKey = KIND_TO_KEY[kind]
  const setter = sizing[`set${stateKey.toUpperCase()}`]
  const state = sizing[stateKey]

  const [file, setFile] = useState(null)        // currently staged image (single)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [textDraft, setTextDraft] = useState('')
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [busyMode, setBusyMode] = useState(null) // 'estimate' | 'run' — for button label disambiguation
  const [error, setError] = useState(null)
  const [runResult, setRunResult] = useState(null) // last "Run to est. outputs" payload
  const inputRef = useRef(null)

  const ready = state.value != null
  const canSubmit = !!file || !!textDraft.trim()

  // Generate a blob preview URL for image files; revoke on change/unmount.
  useEffect(() => {
    if (!file || !file.type?.startsWith('image/')) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  function pickFiles(files) {
    if (!files || files.length === 0) return
    setFile(files[0])  // single image only
  }

  function clearFile() {
    setFile(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  async function estimate() {
    if (!canSubmit) return
    setBusy(true); setBusyMode('estimate'); setError(null)
    try {
      const r = await countTokens({
        kind,
        file: file || undefined,
        text: textDraft.trim() || undefined,
      })
      setter({ value: r.total_tokens, tokens: r.total_tokens })
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false); setBusyMode(null)
    }
  }

  async function runOutputs() {
    if (!canSubmit) return
    setBusy(true); setBusyMode('run'); setError(null); setRunResult(null)
    try {
      const r = await runAndCount({
        file: file || undefined,
        text: textDraft.trim() || undefined,
      })
      // The input card owns a3, but the call also returns output text + image
      // tokens — push those into a4 and a5.
      sizing.setA3({ value: r.input_tokens, tokens: r.input_tokens })
      sizing.setA4({ value: r.output_text_tokens, tokens: r.output_text_tokens })
      sizing.setA5({ value: r.output_image_tokens, tokens: r.output_image_tokens })
      setRunResult(r)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false); setBusyMode(null)
    }
  }

  function onDrop(e) {
    e.preventDefault(); setOver(false)
    pickFiles(e.dataTransfer.files)
  }

  function onTextKey(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      estimate()
    }
  }

  return (
    <div className={`${s.card} ${ready ? s.ready : ''}`}>
      <div className={s.head}>
        <div className={s.label}>
          <div className={s.title}>{title}</div>
          <div className={s.desc}>{desc}</div>
        </div>
        <div className={`${s.statusPill} ${ready ? s.set : ''}`}>
          <span className={s.dot} />
          {ready ? `${Math.round(state.value).toLocaleString()} tok` : 'Not estimated'}
        </div>
      </div>
      <div className={s.body}>
        <div className={s.inputStack}>
          {accept && (
            <div className={s.imagePicker}>
              <label
                className={`${s.drop} ${over ? s.over : ''} ${busy ? s.busy : ''} ${file ? s.dropFilled : ''}`}
                onDragOver={e => { e.preventDefault(); setOver(true) }}
                onDragLeave={() => setOver(false)}
                onDrop={onDrop}
              >
                {file ? (
                  <>
                    {previewUrl && (
                      <img
                        src={previewUrl}
                        alt={file.name}
                        className={s.previewImg}
                      />
                    )}
                    <span className={s.dropPrimary}>📎 {file.name}</span>
                    <span className={s.dropHint}>Click to replace</span>
                  </>
                ) : (
                  <>
                    <span className={s.plus}>+</span>
                    <span className={s.dropPrimary}>Drop one image or click to browse</span>
                    <span className={s.dropHint}>One representative sample</span>
                  </>
                )}
                <input
                  ref={inputRef}
                  type="file"
                  accept={accept}
                  className={s.fileInput}
                  onChange={e => pickFiles(e.target.files)}
                />
              </label>
              {file && (
                <button type="button" className={s.clearBtn} onClick={clearFile}>
                  Remove
                </button>
              )}
            </div>
          )}

          {allowText && (
            <div className={s.textBlock}>
              <div className={s.textBlockHead}>
                <span className={s.textBlockLabel}>
                  {accept ? 'Add a representative text prompt' : 'Paste a text sample'}
                </span>
                <span className={s.textBlockHint}>⌘/Ctrl ↵ to estimate</span>
              </div>
              <textarea
                className={s.textArea}
                placeholder={accept
                  ? 'e.g. "Generate a photorealistic image of…"'
                  : 'Paste a representative output text sample…'}
                value={textDraft}
                onChange={e => setTextDraft(e.target.value)}
                onKeyDown={onTextKey}
              />
            </div>
          )}
        </div>

        <div className={s.estimateRow}>
          <button
            type="button"
            className={`btn btn-primary ${s.estimateBtn}`}
            onClick={estimate}
            disabled={busy || !canSubmit}
          >
            {busyMode === 'estimate' ? 'Estimating…' : ready ? '↻ Re-estimate' : 'Estimate'}
          </button>
          {runEndToEnd && (
            <button
              type="button"
              className={`btn btn-outline ${s.estimateBtn} ${s.runBtn}`}
              onClick={runOutputs}
              disabled={busy || !canSubmit}
              title="Calls the model once and uses usageMetadata to populate input + output token counts (a3, a4, a5)."
            >
              {busyMode === 'run' ? 'Running model…' : '⚡ Run Model to est. Outputs'}
            </button>
          )}
          <div className={`${s.resultDisplay} ${ready ? s.resultDisplaySet : ''}`}>
            <span className={s.resultDisplayLabel}>Tokens</span>
            <span className={s.resultDisplayValue}>
              {ready ? Math.round(state.value).toLocaleString() : '—'}
            </span>
          </div>
        </div>

        <AnimatePresence>
          {runResult && (
            <motion.div
              key="run-result"
              className={s.runResult}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: EASE }}
            >
              <div className={s.runResultLabel}>
                Model run · usageMetadata populated A3, A4, A5
              </div>
              <div className={s.runResultGrid}>
                <div>
                  <span className={s.runResultMetric}>Input</span>
                  <span className={s.runResultValue}>{runResult.input_tokens.toLocaleString()}</span>
                </div>
                <div>
                  <span className={s.runResultMetric}>Output text</span>
                  <span className={s.runResultValue}>{runResult.output_text_tokens.toLocaleString()}</span>
                </div>
                <div>
                  <span className={s.runResultMetric}>Output image</span>
                  <span className={s.runResultValue}>{runResult.output_image_tokens.toLocaleString()}</span>
                </div>
              </div>
            </motion.div>
          )}
          {error && (
            <motion.div
              key="err"
              className={s.error}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: EASE }}
            >! {error}</motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
