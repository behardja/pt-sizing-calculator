import { Link, useLocation } from 'react-router-dom'
import s from './Stepper.module.css'
import { STEPS } from '../state/SizingContext.jsx'

export default function Stepper() {
  const { pathname } = useLocation()
  const idx = Math.max(0, STEPS.findIndex(x => x.path === pathname))

  return (
    <nav className={s.bar} aria-label="Workflow steps">
      <div className="page" style={{ width: '100%' }}>
        <div className={s.row}>
          {STEPS.map((step, i) => {
            const isActive = i === idx
            const isComplete = i < idx
            const cls = `${s.step} ${isActive ? s.active : ''} ${isComplete ? s.complete : ''}`
            return (
              <div key={step.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
                <Link to={step.path} className={cls}>
                  <span className={s.dot}>{isComplete ? '✓' : step.num}</span>
                  <span className={s.label}>{step.label}</span>
                </Link>
                {i < STEPS.length - 1 && (
                  <span className={`${s.connector} ${i < idx ? s.lit : ''}`} />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
