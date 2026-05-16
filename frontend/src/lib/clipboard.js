/**
 * Copy a string to the clipboard, with a fallback for non-secure contexts.
 *
 * navigator.clipboard only works on HTTPS or http://localhost. When the dev
 * server is hit over the external IP (plain HTTP), the modern API throws —
 * fall back to a temporary textarea + document.execCommand('copy'), which
 * still works in plain-HTTP contexts on every browser we care about.
 *
 * Returns true on success, false if both paths failed.
 */
export async function copyToClipboard(text) {
  // Modern API — preferred when available (HTTPS / localhost).
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Fall through to legacy path.
    }
  }

  // Legacy fallback. Some browsers require the textarea to be visible-ish, so
  // we use opacity 0 + fixed positioning instead of display:none.
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '0'
    ta.style.left = '0'
    ta.style.opacity = '0'
    ta.style.pointerEvents = 'none'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    ta.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
