import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import s from './TopBar.module.css'
import { useSizing, MODELS } from '../state/SizingContext.jsx'

export default function TopBar() {
  const { model, setModel } = useSizing()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function onClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const selected = MODELS.find(m => m.id === model) ?? MODELS[0]

  return (
    <header className={s.bar}>
      <div className="page" style={{ width: '100%' }}>
        <div className={s.row}>
          <Link to="/" className={s.brand}>
            <img
              src="/google-cloud-logo.png"
              alt="Google Cloud"
              className={s.logoMark}
            />
            <span className={s.brandText}>
              <span className={s.product}>PT Sizing</span>
              <span className={s.org}>Vertex AI · Provisioned Throughput</span>
            </span>
          </Link>

          <div className={s.modelGroup}>
            <span className={s.modelLabel}>Model</span>
            <div className={s.dropdown} ref={ref}>
              <button
                type="button"
                className={s.dropdownButton}
                aria-expanded={open}
                aria-haspopup="listbox"
                onClick={() => setOpen(o => !o)}
              >
                <span className={s.dropdownMain}>
                  <span className={s.nick}>{selected.nickname}</span>
                  <span className={s.id}>{selected.id}</span>
                </span>
                <span className={s.caret}>⌄</span>
              </button>
              {open && (
                <div className={s.menu} role="listbox">
                  {MODELS.map(m => (
                    <button
                      key={m.id}
                      type="button"
                      role="option"
                      aria-selected={m.id === model}
                      className={`${s.menuItem} ${m.id === model ? s.selected : ''}`}
                      onClick={() => { setModel(m.id); setOpen(false) }}
                      disabled={!m.available}
                    >
                      <span className={s.nick}>{m.nickname}</span>
                      <span className={s.id}>{m.id}</span>
                      {!m.available && <span className={s.badge}>coming soon</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <a
            className={s.docsLink}
            href="https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/provisioned-throughput/supported-models"
            target="_blank"
            rel="noreferrer"
          >
            Docs ↗
          </a>
        </div>
      </div>
    </header>
  )
}
