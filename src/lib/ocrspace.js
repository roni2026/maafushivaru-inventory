// ────────────────────────────────────────────────────────────────────────────
// ocrspace.js — OCR via the OCR.space cloud API (replaces tesseract.js)
//
// Why OCR.space instead of Tesseract?
//   • Far better accuracy on scanned/photographed forms (Engine 2 + table mode)
//   • No multi-MB worker download, no in-browser CPU grind
//   • PDFs are read natively — no pdf.js page rendering needed
//
// IMPORTANT LIMITS (enforced by the free/registered plan):
//   • Max file size: 1 MB. Larger files are rejected up-front by the caller
//     with a "File too large" message — we never upload them.
// ────────────────────────────────────────────────────────────────────────────

// Default API key (can be overridden from Settings → key `ocr_space_api_key`).
export const DEFAULT_OCR_API_KEY = 'K88109865088957'

// Hard size ceiling — OCR.space rejects anything above 1 MB.
export const MAX_OCR_BYTES = 1024 * 1024            // 1 MB
export const MAX_OCR_LABEL = '1 MB'

const OCR_ENDPOINT = 'https://api.ocr.space/parse/image'

export function isTooLarge(file) {
  return !!file && file.size > MAX_OCR_BYTES
}

export function prettySize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function fileType(file) {
  const t = (file.type || '').toLowerCase()
  if (t.includes('pdf')) return 'PDF'
  if (t.includes('png')) return 'PNG'
  if (t.includes('gif')) return 'GIF'
  if (t.includes('tif')) return 'TIF'
  if (t.includes('bmp')) return 'BMP'
  return 'JPG'
}

// Run OCR on a single file. Returns the combined plain text of every page.
// `onProgress` receives ({ label, pct }) so the UI can show a progress bar.
export async function ocrSpaceExtract(file, { apiKey, onProgress } = {}) {
  if (!file) throw new Error('No file provided')
  if (isTooLarge(file)) {
    throw new Error(`File too large (${prettySize(file.size)}). Maximum is ${MAX_OCR_LABEL}.`)
  }

  onProgress?.({ label: 'Uploading to OCR…', pct: 20 })

  const form = new FormData()
  form.append('file', file, file.name || 'scan')
  form.append('apikey', apiKey || DEFAULT_OCR_API_KEY)
  form.append('language', 'eng')
  form.append('isOverlayRequired', 'false')
  form.append('filetype', fileType(file))
  form.append('detectOrientation', 'true')
  form.append('scale', 'true')
  form.append('isTable', 'true')       // form-style layout → keeps columns aligned
  form.append('OCREngine', '2')        // Engine 2 = best accuracy for printed text

  onProgress?.({ label: 'Recognising text…', pct: 55 })

  let res
  try {
    res = await fetch(OCR_ENDPOINT, { method: 'POST', body: form })
  } catch (e) {
    throw new Error('Network error contacting OCR service. Check your connection.')
  }

  if (!res.ok) throw new Error(`OCR service error ${res.status}`)

  const data = await res.json().catch(() => ({}))

  if (data.IsErroredOnProcessing) {
    const msg = Array.isArray(data.ErrorMessage) ? data.ErrorMessage.join(' ') : (data.ErrorMessage || 'OCR failed')
    throw new Error(msg)
  }

  onProgress?.({ label: 'Parsing results…', pct: 90 })

  const text = (data.ParsedResults || [])
    .map(r => r.ParsedText || '')
    .join('\n')

  return text
}
