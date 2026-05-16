import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import s from './Card.module.css'
import { useSizing } from '../state/SizingContext.jsx'
import { countTokens, runAndCount } from '../lib/api.js'

const EASE = [0.4, 0, 0.2, 1]

/**
 * Token cards.
 *  - kind="input"        → DUAL writer: populates a3 (text) AND a4 (image)
 *                          from a single countTokens call (uses promptTokensDetails).
 *                          Also exposes the optional "Run Model to est. Outputs"
 *                          button that additionally fills a5 + a6.
 *  - kind="output_text"  → single writer: a5
 *  - kind="output_image" → single writer: a6
 */
export default function TokenCard({ title, desc, kind, accept, allowText = true, runEndToEnd = false }) {
  const sizing = useSizing()
  const isInput = kind === 'input'
  const singleKey = kind === 'output_text' ? 'a5' : (kind === 'output_image' ? 'a6' : null)
  const singleSetter = singleKey ? sizing[`set${singleKey.toUpperCase()}`] : null
  const singleState  = singleKey ? sizing[singleKey] : null

  const allowMultiple = isInput
  // files: [{ id, file, previewUrl|null }]. Always a list; single-mode cards
  // just cap it at length 1.
  const [files, setFiles] = useState([])
  const [textDraft, setTextDraft] = useState('')
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [busyMode, setBusyMode] = useState(null)
  const [error, setError] = useState(null)
  // Last Vertex REST request we sent (for the "Show request body" disclosure).
  // Shape: { kind: 'countTokens' | 'generateContent', url, body, fallbackUsed? }
  const [lastRequest, setLastRequest] = useState(null)
  const inputRef = useRef(null)
  const idCtr = useRef(0)
  const filesRef = useRef(files)
  filesRef.current = files

  // Combined "ready" + total for the header pill.
  let ready, totalForPill, viaRun, sourceImage, sourceText
  if (isInput) {
    ready = sizing.a3.value != null || sizing.a4.value != null
    totalForPill = (sizing.a3.value || 0) + (sizing.a4.value || 0)
    viaRun = false   // input card itself doesn't get the purple variant
  } else {
    ready = singleState.value != null
    totalForPill = singleState.value
    viaRun = !!singleState.viaRun
    sourceImage = singleState.sourceImage
    sourceText = singleState.sourceText
  }

  const canSubmit = files.length > 0 || !!textDraft.trim()

  // Revoke all object URLs on unmount.
  useEffect(() => {
    return () => {
      for (const f of filesRef.current) {
        if (f.previewUrl) URL.revokeObjectURL(f.previewUrl)
      }
    }
  }, [])

  function pickFiles(rawList) {
    if (!rawList || rawList.length === 0) return
    const additions = Array.from(rawList).map(f => ({
      id: ++idCtr.current,
      file: f,
      previewUrl: f.type?.startsWith('image/') ? URL.createObjectURL(f) : null,
    }))
    setFiles(prev => {
      if (allowMultiple) return [...prev, ...additions]
      // Single mode: replace + revoke previous URL.
      for (const f of prev) if (f.previewUrl) URL.revokeObjectURL(f.previewUrl)
      return additions.slice(0, 1)
    })
  }

  function removeFile(id) {
    setFiles(prev => {
      const target = prev.find(x => x.id === id)
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl)
      const next = prev.filter(x => x.id !== id)
      // Reset the input so re-selecting the same file fires onChange.
      if (next.length === 0 && inputRef.current) inputRef.current.value = ''
      return next
    })
  }

  function clearAllFiles() {
    for (const f of filesRef.current) if (f.previewUrl) URL.revokeObjectURL(f.previewUrl)
    setFiles([])
    if (inputRef.current) inputRef.current.value = ''
  }

  function rawFiles() {
    return files.map(f => f.file)
  }

  async function estimate() {
    if (!canSubmit) return
    setBusy(true); setBusyMode('estimate'); setError(null)
    try {
      const r = await countTokens({
        kind,
        files: rawFiles(),
        text: textDraft.trim() || undefined,
      })
      if (isInput) {
        sizing.setA3({ value: r.text_tokens })
        sizing.setA4({ value: r.image_tokens })
      } else {
        singleSetter({ value: r.total_tokens })
      }
      if (r.request) {
        setLastRequest({
          kind: 'countTokens',
          url: r.request.url,
          body: r.request.body,
          fallbackUsed: !!r.fallback_used,
        })
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false); setBusyMode(null)
    }
  }

  async function runOutputs() {
    if (!canSubmit) return
    setBusy(true); setBusyMode('run'); setError(null)
    try {
      const r = await runAndCount({
        files: rawFiles(),
        text: textDraft.trim() || undefined,
      })
      if (r.request) {
        setLastRequest({
          kind: 'generateContent',
          url: r.request.url,
          body: r.request.body,
        })
      }
      // Input card: split between a3 (text) and a4 (image)
      sizing.setA3({ value: r.input_text_tokens })
      sizing.setA4({ value: r.input_image_tokens })
      // Output cards (a5 / a6): purple viaRun + preview source
      sizing.setA5({
        value: r.output_text_tokens,
        viaRun: true,
        sourceText: r.output_text,
      })
      sizing.setA6({
        value: r.output_image_tokens,
        viaRun: true,
        sourceImage: r.output_image_data_url,
      })
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false); setBusyMode(null)
    }
  }

  function onDrop(e) { e.preventDefault(); setOver(false); pickFiles(e.dataTransfer.files) }
  function onTextKey(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); estimate() }
  }

  return (
    <div className={`${s.card} ${ready ? s.ready : ''} ${viaRun ? s.viaRun : ''}`}>
      <div className={s.head}>
        <div className={s.label}>
          <div className={s.title}>{title}</div>
          <div className={s.desc}>{desc}</div>
        </div>
        <div className={`${s.statusPill} ${ready ? s.set : ''} ${viaRun ? s.viaRunPill : ''}`}>
          <span className={s.dot} />
          {ready ? `${Math.round(totalForPill).toLocaleString()} tok` : 'Not estimated'}
          {viaRun && <span className={s.viaRunBadge}>via model run</span>}
        </div>
      </div>
      <div className={s.body}>
        {(sourceImage || sourceText) && (
          <div className={s.runPreview}>
            <div className={s.runPreviewLabel}>Model output preview</div>
            <div className={s.runPreviewBody}>
              {sourceImage && (
                <img src={sourceImage} alt="Model-generated image" className={s.runPreviewImg} />
              )}
              {sourceText && <pre className={s.runPreviewText}>{sourceText}</pre>}
            </div>
          </div>
        )}

        <div className={s.inputStack}>
          {accept && (
            <div className={s.imagePicker}>
              <label
                className={`${s.drop} ${over ? s.over : ''} ${busy ? s.busy : ''} ${files.length ? s.dropFilled : ''}`}
                onDragOver={e => { e.preventDefault(); setOver(true) }}
                onDragLeave={() => setOver(false)}
                onDrop={onDrop}
              >
                {files.length === 0 ? (
                  <>
                    <span className={s.plus}>+</span>
                    <span className={s.dropPrimary}>
                      {allowMultiple
                        ? 'Drop images or click to browse'
                        : 'Drop one image or click to browse'}
                    </span>
                    <span className={s.dropHint}>
                      {allowMultiple
                        ? 'One or more representative samples (multiselect supported)'
                        : 'One representative sample'}
                    </span>
                  </>
                ) : (
                  <>
                    <div className={s.thumbsGrid}>
                      {files.map(f => (
                        <div key={f.id} className={s.thumb}>
                          <div className={s.thumbImgWrap}>
                            {f.previewUrl && (
                              <img src={f.previewUrl} alt={f.file.name} className={s.thumbImg} />
                            )}
                            <button
                              type="button"
                              className={s.thumbRemove}
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                removeFile(f.id)
                              }}
                              aria-label={`Remove ${f.file.name}`}
                              title={`Remove ${f.file.name}`}
                            >×</button>
                          </div>
                          <span className={s.thumbName} title={f.file.name}>{f.file.name}</span>
                        </div>
                      ))}
                      {allowMultiple && (
                        // Explicit "+" tile that programmatically opens the
                        // file picker. Using a real button (not relying on the
                        // wrapping label) avoids ambiguity about which child
                        // element receives the click.
                        <button
                          type="button"
                          className={s.thumbAdd}
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            inputRef.current?.click()
                          }}
                          aria-label="Add more images"
                        >
                          <span className={s.thumbAddPlus}>+</span>
                          <span className={s.thumbAddLabel}>Add more</span>
                        </button>
                      )}
                    </div>
                    <span className={s.dropHint}>
                      {allowMultiple
                        ? `${files.length} staged · drop more here or click the + tile`
                        : 'Click to replace'}
                    </span>
                  </>
                )}
                <input
                  ref={inputRef}
                  type="file"
                  accept={accept}
                  multiple={allowMultiple}
                  className={s.fileInput}
                  onChange={e => pickFiles(e.target.files)}
                />
              </label>
              {files.length > 0 && (
                <button type="button" className={s.clearBtn} onClick={clearAllFiles}>
                  {files.length > 1 ? 'Remove all' : 'Remove'}
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
              title="Calls the model once and uses usageMetadata to populate input + output token counts."
            >
              {busyMode === 'run' ? 'Running model…' : '⚡ Run Model to est. Outputs'}
            </button>
          )}

          {/* Result display — dual for input, single for output cards */}
          {isInput ? (
            <div className={s.dualResult}>
              <div className={`${s.resultDisplay} ${sizing.a3.value != null ? s.resultDisplaySet : ''}`}>
                <span className={s.resultDisplayLabel}>Text tokens</span>
                <span className={s.resultDisplayValue}>
                  {sizing.a3.value != null ? Math.round(sizing.a3.value).toLocaleString() : '—'}
                </span>
              </div>
              <div className={`${s.resultDisplay} ${sizing.a4.value != null ? s.resultDisplaySet : ''}`}>
                <span className={s.resultDisplayLabel}>Image tokens</span>
                <span className={s.resultDisplayValue}>
                  {sizing.a4.value != null ? Math.round(sizing.a4.value).toLocaleString() : '—'}
                </span>
              </div>
            </div>
          ) : (
            <div className={`${s.resultDisplay} ${ready ? s.resultDisplaySet : ''}`}>
              <span className={s.resultDisplayLabel}>Tokens</span>
              <span className={s.resultDisplayValue}>
                {ready ? Math.round(totalForPill).toLocaleString() : '—'}
              </span>
            </div>
          )}
        </div>

        <AnimatePresence>
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

        {lastRequest && (
          <details className={s.queries}>
            <summary>
              Show last {lastRequest.kind} request
              {lastRequest.fallbackUsed && (
                <span className={s.fallbackNote}>
                  · split-modality fallback used (2 extra calls)
                </span>
              )}
            </summary>
            <div className={s.queryBlock} style={{ marginTop: 8 }}>
              <div className={s.requestUrlRow}>
                <span className={s.requestVerb}>POST</span>
                <span className={s.requestUrl}>{lastRequest.url}</span>
              </div>
              <pre className={s.requestBody}>
                {JSON.stringify(lastRequest.body, null, 2)}
              </pre>
            </div>
          </details>
        )}
      </div>
    </div>
  )
}
