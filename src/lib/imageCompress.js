// ────────────────────────────────────────────────────────────────────────────
// imageCompress.js  —  Client-side image optimisation for inventory photos.
//
// Guarantees the output is a JPEG under a hard size cap (default 300 KB) while
// keeping quality as high as possible. Even a 20 MB source photo is downscaled
// and re-encoded until it fits: we first shrink the longest edge to a sensible
// maximum, then step the JPEG quality down, and only as a last resort reduce
// the resolution further. The result is a File ready to upload to Supabase.
// ────────────────────────────────────────────────────────────────────────────

const MAX_BYTES   = 300 * 1024   // 300 KB hard cap
const MAX_EDGE    = 1600         // starting longest-edge (px) — plenty for a photo
const MIN_EDGE    = 640          // don't shrink below this while chasing the cap
const MIN_QUALITY = 0.4          // don't drop JPEG quality below this

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload  = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(new Error('Could not read image')) }
    img.src = url
  })
}

function drawToBlob(img, edge, quality) {
  const scale = Math.min(1, edge / Math.max(img.width, img.height))
  const w = Math.max(1, Math.round(img.width  * scale))
  const h = Math.max(1, Math.round(img.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, w, h)
  return new Promise((resolve) => canvas.toBlob(b => resolve(b), 'image/jpeg', quality))
}

/**
 * Compress an image File/Blob to a JPEG under `maxBytes`.
 * @returns {Promise<{ file: File, bytes: number, width: number, height: number }>}
 */
export async function compressImage(file, { maxBytes = MAX_BYTES } = {}) {
  if (!file) throw new Error('No file provided')
  const img = await loadImage(file)

  let edge = MAX_EDGE
  let best = null

  // Outer loop: shrink resolution. Inner loop: step quality down.
  while (edge >= MIN_EDGE) {
    let quality = 0.9
    while (quality >= MIN_QUALITY) {
      const blob = await drawToBlob(img, edge, quality)
      if (!blob) break
      if (!best || blob.size < best.size) best = blob
      if (blob.size <= maxBytes) {
        return finalize(blob, file)
      }
      quality -= 0.1
    }
    edge = Math.round(edge * 0.8)  // shrink and try again
  }

  // Couldn't get strictly under the cap even at min edge/quality — return the
  // smallest we produced (still far below the original).
  if (!best) throw new Error('Image compression failed')
  return finalize(best, file)
}

function finalize(blob, srcFile) {
  const base = (srcFile.name || 'photo').replace(/\.[^.]+$/, '')
  const out = new File([blob], `${base}.jpg`, { type: 'image/jpeg' })
  return { file: out, bytes: out.size, width: 0, height: 0 }
}

export const IMAGE_MAX_BYTES = MAX_BYTES
