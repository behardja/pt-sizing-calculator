// Tiny fetch wrapper. All paths are relative — Vite proxies /api → :8000.

async function handle(resp) {
  const text = await resp.text()
  let body = null
  try { body = text ? JSON.parse(text) : null } catch { body = { detail: text } }
  if (!resp.ok) {
    const msg = body?.detail || body?.message || `HTTP ${resp.status}`
    throw new Error(msg)
  }
  return body
}

export async function getHostProject() {
  return handle(await fetch('/api/host-project'))
}

export async function queryMonitoring({
  projectId,
  model = 'gemini-3.1-flash-image-preview',
  windowDays = 7,
  daysOfWeek,
  hourStart,
  hourEnd,
  timezone,
}) {
  const body = { project_id: projectId, model, window_days: windowDays }
  if (Array.isArray(daysOfWeek)) body.days_of_week = daysOfWeek
  if (Number.isFinite(hourStart)) body.hour_start = hourStart
  if (Number.isFinite(hourEnd))   body.hour_end   = hourEnd
  if (typeof timezone === 'string' && timezone) body.timezone = timezone
  return handle(await fetch('/api/monitoring/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

function _appendImages(fd, files) {
  // Accept array of File objects, or a single File for back-compat.
  if (!files) return
  const list = Array.isArray(files) ? files : [files]
  for (const f of list) {
    if (f) fd.append('images', f)
  }
}

export async function countTokens({ kind, files, text }) {
  const fd = new FormData()
  fd.append('kind', kind)
  _appendImages(fd, files)
  if (text) fd.append('text', text)
  return handle(await fetch('/api/count-tokens', { method: 'POST', body: fd }))
}

export async function runAndCount({ files, text }) {
  const fd = new FormData()
  _appendImages(fd, files)
  if (text) fd.append('text', text)
  return handle(await fetch('/api/run-and-count', { method: 'POST', body: fd }))
}
