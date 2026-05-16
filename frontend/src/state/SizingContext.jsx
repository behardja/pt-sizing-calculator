import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { getHostProject } from '../lib/api.js'

const SizingContext = createContext(null)

export const STEPS = [
  { id: 'sizing',  path: '/',        num: '01', label: 'Sizing inputs' },
  { id: 'summary', path: '/summary', num: '02', label: 'Summary' },
]

/**
 * The Google Cloud PT estimator accepts the publisher model name as a matrix
 * parameter on the path, which prefills the model selector when the page loads.
 * Example for Nano Banana 2:
 *   https://console.cloud.google.com/agent-platform/provisioned-throughput/price-estimate;publisherModelName=publishers%2Fgoogle%2Fmodels%2Fgemini-3.1-flash-image-preview
 */
export function estimatorUrlFor(modelId) {
  const publisherName = `publishers/google/models/${modelId}`
  return (
    'https://console.cloud.google.com/agent-platform/provisioned-throughput/price-estimate'
    + ';publisherModelName=' + encodeURIComponent(publisherName)
  )
}

export const MODELS = [
  // Only Gemini Flash image model populated for now.
  {
    id: 'gemini-3.1-flash-image-preview',
    label: 'Gemini 3.1 Flash Image',
    nickname: 'Nano Banana 2',
    family: 'flash',
    available: true,
  },
]

export function SizingProvider({ children }) {
  const [model, setModel]       = useState(MODELS[0].id)
  // Monitoring inputs are shared across the A1 and A2 cards so the user
  // only enters project ID + window + day/hour filter once.
  // Default is business hours (Mon–Fri, 9–17 local) — most workloads we size
  // are interactive traffic that runs during the workday. User can broaden
  // to 24×7 by clicking all day chips and setting hours to 0–24.
  const [monitoring, setMonitoring] = useState({
    projectId: '',
    windowDays: 7,
    daysOfWeek: [0, 1, 2, 3, 4],          // Mon..Fri
    hourStart: 9,
    hourEnd: 17,                           // exclusive; 9..17 covers 9:00–16:59
    timezone: typeof Intl !== 'undefined'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : 'UTC',
  })

  // Auto-fill the project ID from the backend's ADC / host metadata once on
  // app load. The user can still overwrite it for a customer's project.
  useEffect(() => {
    let cancelled = false
    getHostProject()
      .then(r => {
        if (cancelled || !r?.project_id) return
        setMonitoring(m => m.projectId ? m : { ...m, projectId: r.project_id })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])
  const [a1, setA1] = useState({ value: null, diag: null, queries: null })
  const [a2, setA2] = useState({ value: null, diag: null, queries: null })
  const [a3, setA3] = useState({ value: null, tokens: null })    // image + text combined sample
  const [a4, setA4] = useState({ value: null, tokens: null })    // text-only sample
  const [a5, setA5] = useState({ value: null, tokens: null })    // image-only sample

  const value = useMemo(() => ({
    model, setModel,
    monitoring, setMonitoring,
    a1, setA1,
    a2, setA2,
    a3, setA3,
    a4, setA4,
    a5, setA5,
  }), [model, monitoring, a1, a2, a3, a4, a5])

  return <SizingContext.Provider value={value}>{children}</SizingContext.Provider>
}

export function useSizing() {
  const ctx = useContext(SizingContext)
  if (!ctx) throw new Error('useSizing must be used within SizingProvider')
  return ctx
}
