import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase, selectAll } from '../lib/supabase'
import {
  ScanLine, Upload, Loader, Plus, Trash2, Check, X,
  RefreshCw, FileText, AlertCircle, ChevronLeft
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Input, { Select } from '../components/ui/Input'

// ── OCR text parser ───────────────────────────────────────
const SKIP_PATTERNS = [
  /^(date|item|part|qty|quantity|no|no\.|#|issuance|form|store|signature|department|issued|by|total|description|unit|received)/i,
  /^-{3,}/, /^={3,}/, /^\*{3,}/,
]
const PART_NUM_RE = /\b([A-Z]{1,5}[-]?\d{1,5}[A-Z]?)\b/

function parseLine(line) {
  const trimmed = line.replace(/\s+/g, ' ').trim()
  if (trimmed.length < 3) return null
  if (SKIP_PATTERNS.some(p => p.test(trimmed))) return null

  // Find part number
  const partMatch = trimmed.match(PART_NUM_RE)
  const partNumber = partMatch ? partMatch[1] : null

  // Find all numbers in line → last significant one = quantity
  const allNums = [...trimmed.matchAll(/\b(\d+(?:\.\d+)?)\b/g)]
    .map(m => parseFloat(m[1]))
    .filter(n => n > 0 && n < 99999)
  const qty = allNums.length > 0 ? allNums[allNums.length - 1] : 1

  // Build name: remove part#, leading serial number, trailing qty
  let name = trimmed
  if (partNumber) name = name.replace(partNumber, '')
  name = name
    .replace(/^\s*\d{1,3}\s*[.\-)]?\s*/, '') // strip leading "1." or "1)"
    .replace(/\b\d+(?:\.\d+)?\s*(pcs|kg|g|L|mL|bottles?|cans?|boxes?)?\s*$/i, '')
    .replace(/[✓✗√×]/g, '')
    .trim()
  if (name.length < 2 && !partNumber) return null

  return { partNumber, name, qty }
}

function parseOCRText(rawText, inventoryItems) {
  const lines = rawText.split('\n')
  const results = []
  const seenParts = new Set()

  for (const line of lines) {
    const parsed = parseLine(line)
    if (!parsed) continue

    // Try DB match by part number
    let matched = null
    if (parsed.partNumber) {
      matched = inventoryItems.find(i =>
        i.part_number.toUpperCase().replace(/[-\s]/g, '') ===
        parsed.partNumber.toUpperCase().replace(/[-\s]/g, '')
      )
    }
    // Try DB match by name similarity (fallback)
    if (!matched && parsed.name.length > 4) {
      matched = inventoryItems.find(i =>
        i.name.toLowerCase().includes(parsed.name.toLowerCase().slice(0, 8))
      )
    }

    const key = matched?.id || `${parsed.partNumber}-${parsed.name}`.toLowerCase()
    if (seenParts.has(key)) continue
    seenParts.add(key)

    results.push({
      id:             Math.random().toString(36).slice(2),
      partNumber:     matched?.part_number || parsed.partNumber || '',
      name:           matched?.name        || parsed.name       || '',
      qty:            parsed.qty,
      unit:           matched?.unit        || 'pcs',
      store:          matched?.stores?.name || '',
      itemId:         matched?.id          || null,
      issued:         true,   // default = issued (ticked)
      matchedFromDB:  !!matched,
    })
  }
  return results
}

// ── PDF page → canvas ─────────────────────────────────────
async function pdfPageToCanvas(page, scale = 2.0) {
  const viewport = page.getViewport({ scale })
  const canvas   = document.createElement('canvas')
  canvas.width   = viewport.width
  canvas.height  = viewport.height
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
  return canvas
}

// ── Component ─────────────────────────────────────────────
const newRow = () => ({
  id: Math.random().toString(36).slice(2),
  partNumber:'', name:'', qty:1, unit:'pcs',
  store:'', itemId:null, issued:true, matchedFromDB:false,
})

const STAGES = { upload:'upload', processing:'processing', review:'review' }

export default function IssuanceScan() {
  const navigate   = useNavigate()
  const fileRef    = useRef(null)

  const [stage,    setStage]    = useState(STAGES.upload)
  const [progress, setProgress] = useState({ label:'', pct:0 })
  const [rows,     setRows]     = useState([])
  const [inventory,setInventory]= useState([])
  const [stores,   setStores]   = useState([])
  const [date,     setDate]     = useState(new Date().toISOString().split('T')[0])
  const [issuedBy, setIssuedBy] = useState('')
  const [submitting,setSubmitting]=useState(false)
  const [rawOCR,   setRawOCR]   = useState('')

  useEffect(() => {
    Promise.all([
      selectAll(() => supabase.from('items').select('id,name,part_number,unit,stores(name)').order('name')),
      supabase.from('stores').select('*').order('name'),
    ]).then(([{ data: inv }, { data: st }]) => {
      setInventory(inv || [])
      setStores(st   || [])
    })
  }, [])

  // Re-match when user edits a part number
  const rematch = useCallback((partNumber) => {
    if (!partNumber) return null
    return inventory.find(i =>
      i.part_number.toUpperCase().replace(/[-\s]/g,'') ===
      partNumber.toUpperCase().replace(/[-\s]/g,'')
    ) || null
  }, [inventory])

  const processFile = async (file) => {
    if (!file) return
    setStage(STAGES.processing)
    setProgress({ label:'Loading file…', pct:5 })
    setRawOCR('')

    try {
      // Lazy-load heavy deps only when needed
      const { createWorker }            = await import('tesseract.js')
      const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist')
      GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.3.136/pdf.worker.min.mjs'

      let pages = [] // array of canvas elements

      if (file.type === 'application/pdf') {
        setProgress({ label:'Reading PDF…', pct:10 })
        const buf = await file.arrayBuffer()
        const pdf = await getDocument({ data: buf }).promise
        for (let i = 1; i <= pdf.numPages; i++) {
          setProgress({ label:`Rendering page ${i} of ${pdf.numPages}…`, pct: 10 + (i / pdf.numPages) * 30 })
          const page = await pdf.getPage(i)
          pages.push(await pdfPageToCanvas(page, 2.5)) // 2.5× scale for better OCR
        }
      } else {
        // Image file — direct OCR
        pages = [file]
      }

      // OCR every page
      let fullText = ''
      const worker = await createWorker('eng', 1, {
        logger: m => {
          if (m.status === 'recognizing text') {
            setProgress({ label:`OCR scanning…`, pct: 45 + m.progress * 45 })
          }
        },
      })

      for (let i = 0; i < pages.length; i++) {
        setProgress({ label:`OCR page ${i + 1} of ${pages.length}…`, pct: 45 + (i / pages.length) * 45 })
        const { data: { text } } = await worker.recognize(pages[i])
        fullText += '\n' + text
      }
      await worker.terminate()
      setRawOCR(fullText)

      setProgress({ label:'Parsing results…', pct:96 })
      const extracted = parseOCRText(fullText, inventory)
      setRows(extracted.length > 0 ? extracted : [newRow()])
      setStage(STAGES.review)

      if (extracted.length === 0) {
        toast('No items auto-detected — add them manually below.', { icon: '⚠️' })
      } else {
        const matched = extracted.filter(r => r.matchedFromDB).length
        toast.success(`Extracted ${extracted.length} items (${matched} matched to inventory)`)
      }
    } catch (err) {
      console.error(err)
      toast.error('OCR failed: ' + err.message)
      setStage(STAGES.upload)
    }
  }

  // Row helpers
  const toggle    = (id)         => setRows(p => p.map(r => r.id===id ? {...r, issued:!r.issued} : r))
  const updateRow = (id, k, v)   => {
    setRows(p => p.map(r => {
      if (r.id !== id) return r
      const updated = { ...r, [k]: v }
      // Auto-rematch when part number changes
      if (k === 'partNumber') {
        const m = rematch(v)
        if (m) { updated.name = m.name; updated.unit = m.unit; updated.store = m.stores?.name||''; updated.itemId = m.id; updated.matchedFromDB = true }
        else   { updated.itemId = null; updated.matchedFromDB = false }
      }
      return updated
    }))
  }
  const addRow    = ()           => setRows(p => [...p, newRow()])
  const delRow    = (id)         => setRows(p => p.filter(r => r.id !== id))
  const allIssued = ()           => setRows(p => p.map(r => ({ ...r, issued:true  })))
  const noneIssued= ()           => setRows(p => p.map(r => ({ ...r, issued:false })))

  const handleSubmit = async () => {
    const toLog = rows.filter(r => r.issued && r.itemId)
    if (!toLog.length) { toast.error('No matched issued items to log'); return }
    if (!issuedBy.trim()) { toast.error('Enter who issued the items'); return }
    setSubmitting(true)
    let success = 0
    try {
      for (const row of toLog) {
        const { data: item } = await supabase.from('items').select('current_stock').eq('id', row.itemId).single()
        const newStock = Math.max(0, Number(item.current_stock) - Number(row.qty))
        await supabase.from('items').update({ current_stock: newStock }).eq('id', row.itemId)
        await supabase.from('issuances').insert({ item_id:row.itemId, date, quantity_issued:Number(row.qty), issued_by:issuedBy, note:'Scanned issuance form' })
        await supabase.from('stock_updates').insert({ item_id:row.itemId, date, quantity_change:-Number(row.qty), new_quantity:newStock, updated_by:issuedBy, note:'Issuance (OCR scan)' })
        success++
      }
      const skipped = rows.filter(r => r.issued && !r.itemId).length
      toast.success(`✅ Logged ${success} issuances${skipped ? ` — ${skipped} unmatched items skipped` : ''}`)
      setStage(STAGES.upload); setRows([])
    } catch (err) { toast.error(err.message) }
    setSubmitting(false)
  }

  const issuedCount   = rows.filter(r => r.issued).length
  const notIssuedCount= rows.filter(r => !r.issued).length
  const unmatchedCount= rows.filter(r => r.issued && !r.itemId).length

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Scan Issuance Form</h1>
          <p className="page-sub">Upload scanned paper forms — OCR reads them automatically</p>
        </div>
        {stage === STAGES.review && (
          <Button variant="secondary" onClick={() => { setStage(STAGES.upload); setRows([]) }}>
            <ChevronLeft className="w-4 h-4" /> Re-scan
          </Button>
        )}
      </div>

      {/* ── Upload ────────────────────────────────────────── */}
      {stage === STAGES.upload && (
        <div className="space-y-5">
          <div className="bg-blue-900/20 border border-blue-700/30 rounded-xl p-4 text-sm text-blue-300">
            <p className="font-semibold mb-2">📋 How to use</p>
            <ol className="list-decimal ml-4 space-y-1.5">
              <li>On your paper issuance form, <strong>tick ✓ items that were issued</strong>, cross ✗ items that were NOT issued</li>
              <li>Scan all pages into <strong>one PDF file</strong> (or take a clear photo)</li>
              <li>Upload it below — Tesseract OCR will read the part numbers, names, and quantities</li>
              <li>Review the extracted list — toggle ✓/✗ for each item</li>
              <li>Adjust quantities, add missing items manually</li>
              <li>Click <strong>"Log Issuances"</strong> — only ticked items are recorded</li>
            </ol>
          </div>

          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); processFile(e.dataTransfer.files[0]) }}
            className="card border-2 border-dashed border-slate-600 hover:border-teal-500 cursor-pointer transition-all text-center py-20 hover:bg-teal-900/10"
          >
            <ScanLine className="w-14 h-14 mx-auto mb-4 text-slate-500" />
            <p className="text-lg font-semibold text-slate-200">Drop your scanned PDF or image here</p>
            <p className="text-slate-500 text-sm mt-2">Supports PDF (multi-page), JPG, PNG · Max ~20 pages recommended</p>
            <button className="mt-5 btn-secondary btn-sm mx-auto">
              <Upload className="w-4 h-4" /> Browse Files
            </button>
            <input ref={fileRef} type="file" accept=".pdf,image/*" className="hidden"
              onChange={e => processFile(e.target.files?.[0])} />
          </div>

          <div className="bg-slate-700/30 rounded-xl p-4 text-sm text-slate-400">
            <p className="font-medium text-slate-300 mb-2">💡 Tips for best OCR accuracy</p>
            <ul className="space-y-1">
              <li>• Scan at <strong>300 DPI or higher</strong></li>
              <li>• Keep the paper flat, no shadows or wrinkles</li>
              <li>• Part numbers like <strong>BEV-001</strong> are most reliably detected</li>
              <li>• OCR works best when part numbers and quantities are in clearly separated columns</li>
              <li>• If OCR misses items, you can <strong>add them manually</strong> in the review step</li>
            </ul>
          </div>
        </div>
      )}

      {/* ── Processing ────────────────────────────────────── */}
      {stage === STAGES.processing && (
        <div className="card text-center py-20">
          <Loader className="w-14 h-14 mx-auto mb-5 text-teal-400 animate-spin" />
          <p className="text-lg font-semibold text-slate-100">{progress.label}</p>
          <p className="text-slate-400 text-sm mt-1">This takes 15–60 seconds for a typical issuance form</p>
          <div className="mt-6 h-3 bg-slate-700 rounded-full overflow-hidden max-w-xs mx-auto">
            <div className="h-full bg-teal-500 rounded-full transition-all duration-300" style={{ width:`${progress.pct}%` }} />
          </div>
          <p className="text-slate-500 text-xs mt-2">{Math.round(progress.pct)}%</p>
          <p className="text-slate-600 text-xs mt-4 max-w-sm mx-auto">
            Tesseract.js runs entirely in your browser — no data is sent to any server.
          </p>
        </div>
      )}

      {/* ── Review ────────────────────────────────────────── */}
      {stage === STAGES.review && (
        <div className="space-y-4">
          {/* Issuance info */}
          <div className="card">
            <p className="font-display text-base font-semibold text-slate-100 mb-3">Issuance Details</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input label="Date of Issuance" type="date" value={date} onChange={e=>setDate(e.target.value)} />
              <Input label="Issued By *" value={issuedBy} onChange={e=>setIssuedBy(e.target.value)} placeholder="Your name" />
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3">
            <div className="card-sm text-center border border-teal-700/30">
              <p className="text-3xl font-bold text-teal-400">{issuedCount}</p>
              <p className="text-xs text-slate-400 mt-1">✓ Issued</p>
            </div>
            <div className="card-sm text-center border border-red-700/30">
              <p className="text-3xl font-bold text-red-400">{notIssuedCount}</p>
              <p className="text-xs text-slate-400 mt-1">✗ Not Issued</p>
            </div>
            <div className="card-sm text-center border border-orange-700/30">
              <p className="text-3xl font-bold text-orange-400">{unmatchedCount}</p>
              <p className="text-xs text-slate-400 mt-1">⚠ Unmatched</p>
            </div>
          </div>

          {/* Review table */}
          <div className="card">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
              <p className="font-display text-base font-semibold text-slate-100">
                Review Items ({rows.length})
              </p>
              <div className="flex gap-2 flex-wrap">
                <button onClick={allIssued}  className="btn-ghost btn-sm text-teal-400">✓ All Issued</button>
                <button onClick={noneIssued} className="btn-ghost btn-sm text-red-400">✗ None Issued</button>
                <button onClick={addRow}     className="btn-secondary btn-sm"><Plus className="w-4 h-4" /> Add Row</button>
              </div>
            </div>

            {/* Legend */}
            <div className="flex gap-4 mb-3 text-xs text-slate-400">
              <span className="flex items-center gap-1.5"><span className="w-6 h-6 bg-teal-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">✓</span>Issued — will be logged</span>
              <span className="flex items-center gap-1.5"><span className="w-6 h-6 bg-red-700 rounded-lg flex items-center justify-center text-white font-bold text-sm">✗</span>Not issued — skipped</span>
            </div>

            <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
              {rows.map((row, idx) => (
                <div key={row.id}
                  className={[
                    'flex items-start gap-2 p-3 rounded-xl border transition-all',
                    row.issued
                      ? 'border-teal-700/30 bg-teal-900/10'
                      : 'border-red-700/30 bg-red-900/10 opacity-55',
                  ].join(' ')}>

                  {/* Row number */}
                  <span className="text-slate-600 text-xs w-5 text-right shrink-0 mt-3">{idx+1}</span>

                  {/* Toggle button */}
                  <button onClick={() => toggle(row.id)}
                    title={row.issued ? 'Click to mark as NOT issued' : 'Click to mark as ISSUED'}
                    className={[
                      'w-10 h-10 rounded-xl flex items-center justify-center shrink-0 font-bold text-xl transition-all mt-0.5',
                      row.issued ? 'bg-teal-600 hover:bg-teal-700 text-white' : 'bg-red-700 hover:bg-red-800 text-white',
                    ].join(' ')}>
                    {row.issued ? '✓' : '✗'}
                  </button>

                  {/* Fields */}
                  <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div>
                      <p className="text-[10px] text-slate-500 mb-0.5">Part #</p>
                      <input
                        className={`input text-xs py-1.5 font-mono ${!row.matchedFromDB && row.partNumber ? 'border-orange-600 focus:ring-orange-500' : ''}`}
                        value={row.partNumber}
                        onChange={e => updateRow(row.id, 'partNumber', e.target.value.toUpperCase())}
                        placeholder="BEV-001"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <p className="text-[10px] text-slate-500 mb-0.5">
                        Item Name {!row.matchedFromDB && <span className="text-orange-400 font-medium">· unmatched</span>}
                      </p>
                      <input
                        className={`input text-xs py-1.5 ${!row.matchedFromDB ? 'border-orange-600/50' : ''}`}
                        value={row.name}
                        onChange={e => updateRow(row.id, 'name', e.target.value)}
                        placeholder="Type item name…"
                      />
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 mb-0.5">Qty Issued</p>
                      <input
                        type="number" min="0.01" step="0.01"
                        className="input text-xs py-1.5 text-teal-300 font-bold"
                        value={row.qty}
                        onChange={e => updateRow(row.id, 'qty', e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Store badge */}
                  <div className="text-[10px] text-slate-500 shrink-0 hidden sm:block w-28 truncate mt-3">
                    {row.store || '— no store —'}
                  </div>

                  {/* Delete */}
                  <button onClick={() => delRow(row.id)} className="p-1.5 text-slate-600 hover:text-red-400 transition-colors mt-1 shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Unmatched warning */}
          {unmatchedCount > 0 && (
            <div className="bg-orange-900/20 border border-orange-700/30 rounded-xl p-3 flex gap-3 text-sm text-orange-300">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p><strong>{unmatchedCount} item{unmatchedCount!==1?'s':''}</strong> marked as issued but could not be matched to your inventory. They will be <strong>skipped</strong> when logging.</p>
                <p className="mt-1">Fix: edit the Part # field to match exactly what's in your Inventory, then the system will auto-match.</p>
              </div>
            </div>
          )}

          {/* Raw OCR text (collapsible) */}
          {rawOCR && (
            <details className="card cursor-pointer">
              <summary className="text-sm text-slate-400 hover:text-slate-200 transition-colors">
                <FileText className="w-4 h-4 inline mr-1.5" />
                View raw OCR text (for troubleshooting)
              </summary>
              <pre className="mt-3 text-xs text-slate-500 whitespace-pre-wrap font-mono max-h-48 overflow-y-auto leading-relaxed">
                {rawOCR}
              </pre>
            </details>
          )}

          {/* Submit */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <button onClick={() => { setStage(STAGES.upload); setRows([]) }}
              className="btn-secondary">
              Discard & Re-scan
            </button>
            <Button onClick={handleSubmit} loading={submitting}
              disabled={!rows.filter(r=>r.issued&&r.itemId).length}>
              ✓ Log {rows.filter(r=>r.issued&&r.itemId).length} Issuance{rows.filter(r=>r.issued&&r.itemId).length!==1?'s':''}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
