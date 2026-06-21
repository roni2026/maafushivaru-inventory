import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase, selectAll } from '../lib/supabase'
import {
  ScanLine, Upload, Loader, Plus, Trash2, Check, X,
  FileText, AlertCircle, ChevronLeft, FileWarning, CheckCircle2, ArrowRight
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Input, { Select } from '../components/ui/Input'
import { ocrSpaceExtract, isTooLarge, prettySize, MAX_OCR_LABEL, DEFAULT_OCR_API_KEY } from '../lib/ocrspace'

// ── OCR text parser ─────────────────────────────────────────────────────────
const SKIP_PATTERNS = [
  /^(date|item|part|qty|quantity|no|no\.|#|issuance|form|store|signature|department|issued|by|total|description|unit|received)/i,
  /^-{3,}/, /^={3,}/, /^\*{3,}/,
]
const PART_NUM_RE = /\b([A-Z]{1,5}[-]?\d{1,5}[A-Z]?)\b/

function parseLine(line) {
  const trimmed = line.replace(/\s+/g, ' ').trim()
  if (trimmed.length < 3) return null
  if (SKIP_PATTERNS.some(p => p.test(trimmed))) return null

  const partMatch = trimmed.match(PART_NUM_RE)
  const partNumber = partMatch ? partMatch[1] : null

  const allNums = [...trimmed.matchAll(/\b(\d+(?:\.\d+)?)\b/g)]
    .map(m => parseFloat(m[1]))
    .filter(n => n > 0 && n < 99999)
  const qty = allNums.length > 0 ? allNums[allNums.length - 1] : 1

  let name = trimmed
  if (partNumber) name = name.replace(partNumber, '')
  name = name
    .replace(/^\s*\d{1,3}\s*[.\-)]?\s*/, '')
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

    let matched = null
    if (parsed.partNumber) {
      matched = inventoryItems.find(i =>
        i.part_number.toUpperCase().replace(/[-\s]/g, '') ===
        parsed.partNumber.toUpperCase().replace(/[-\s]/g, '')
      )
    }
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
      issued:         true,
      matchedFromDB:  !!matched,
    })
  }
  return results
}

const newRow = () => ({
  id: Math.random().toString(36).slice(2),
  partNumber:'', name:'', qty:1, unit:'pcs',
  store:'', itemId:null, issued:true, matchedFromDB:false,
})

const STAGES = { upload:'upload', processing:'processing', review:'review', done:'done' }

export default function IssuanceScan() {
  const navigate   = useNavigate()
  const fileRef    = useRef(null)

  const [stage,    setStage]    = useState(STAGES.upload)
  const [progress, setProgress] = useState({ label:'', pct:0 })
  const [rows,     setRows]     = useState([])
  const [inventory,setInventory]= useState([])
  const [date,     setDate]     = useState(new Date().toISOString().split('T')[0])
  const [issuedBy, setIssuedBy] = useState('')
  const [submitting,setSubmitting]=useState(false)
  const [rawOCR,   setRawOCR]   = useState('')
  const [apiKey,   setApiKey]   = useState(DEFAULT_OCR_API_KEY)

  // ── Multi-file queue ──────────────────────────────────────────────────────
  const [queue,     setQueue]     = useState([])   // files to process, in order
  const [queueIdx,  setQueueIdx]  = useState(0)    // index of file being processed
  const [oversized, setOversized] = useState([])   // [{ name, size }] rejected (> 1 MB)
  const [summary,   setSummary]   = useState([])   // [{ name, logged, skipped }] completed

  useEffect(() => {
    Promise.all([
      selectAll(() => supabase.from('items').select('id,name,part_number,unit,stores(name)').eq('active', true).order('name')),
      supabase.from('settings').select('value').eq('key', 'ocr_space_api_key').maybeSingle(),
    ]).then(([{ data: inv }, { data: keyRow }]) => {
      setInventory(inv || [])
      if (keyRow?.value) setApiKey(keyRow.value)
    })
  }, [])

  const rematch = useCallback((partNumber) => {
    if (!partNumber) return null
    return inventory.find(i =>
      i.part_number.toUpperCase().replace(/[-\s]/g,'') ===
      partNumber.toUpperCase().replace(/[-\s]/g,'')
    ) || null
  }, [inventory])

  // ── OCR a single file → fill the review table ─────────────────────────────
  // Plain function (recreated each render) so it always captures the latest
  // queue / queueIdx when advancing after an OCR failure.
  const ocrFile = async (file) => {
    setStage(STAGES.processing)
    setProgress({ label:`Reading ${file.name}…`, pct:5 })
    setRawOCR('')
    try {
      const text = await ocrSpaceExtract(file, { apiKey, onProgress: setProgress })
      setRawOCR(text)
      setProgress({ label:'Parsing results…', pct:96 })
      const extracted = parseOCRText(text, inventory)
      setRows(extracted.length > 0 ? extracted : [newRow()])
      setStage(STAGES.review)
      if (extracted.length === 0) {
        toast('No items auto-detected — add them manually below.', { icon: '⚠️' })
      } else {
        const matched = extracted.filter(r => r.matchedFromDB).length
        toast.success(`${file.name}: extracted ${extracted.length} (${matched} matched)`)
      }
    } catch (err) {
      console.error(err)
      toast.error(`OCR failed for ${file.name}: ${err.message}`)
      // Skip this file, move on to the next one in the queue.
      advanceQueue({ name: file.name, logged: 0, skipped: 0, error: err.message })
    }
  }

  // ── Handle the user picking one OR many files ─────────────────────────────
  const handleFiles = (fileList) => {
    const files = Array.from(fileList || [])
    if (!files.length) return

    const tooBig = files.filter(isTooLarge).map(f => ({ name: f.name, size: f.size }))
    const valid  = files.filter(f => !isTooLarge(f))

    setOversized(tooBig)
    setSummary([])

    if (tooBig.length) {
      toast.error(`${tooBig.length} file(s) over ${MAX_OCR_LABEL} were skipped`)
    }
    if (!valid.length) {
      // nothing to process — stay on upload screen, oversized banner is shown
      setStage(STAGES.upload)
      return
    }
    setQueue(valid)
    setQueueIdx(0)
    ocrFile(valid[0])
  }

  // ── Move to the next file (or finish) ─────────────────────────────────────
  const advanceQueue = (entry) => {
    setSummary(prev => [...prev, entry])
    const next = queueIdx + 1
    if (next < queue.length) {
      setQueueIdx(next)
      setRows([])
      ocrFile(queue[next])
    } else {
      finishAll()
    }
  }

  // ── Clean up: drop all in-memory file references so nothing lingers ────────
  const finishAll = () => {
    setQueue([])
    setQueueIdx(0)
    setRows([])
    setRawOCR('')
    if (fileRef.current) fileRef.current.value = ''
    setStage(STAGES.done)
  }

  // Row helpers
  const toggle    = (id)         => setRows(p => p.map(r => r.id===id ? {...r, issued:!r.issued} : r))
  const updateRow = (id, k, v)   => {
    setRows(p => p.map(r => {
      if (r.id !== id) return r
      const updated = { ...r, [k]: v }
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

  // ── Confirm quantities for the current file, log them, move on ────────────
  const confirmAndContinue = async () => {
    const toLog = rows.filter(r => r.issued && r.itemId)
    if (!issuedBy.trim()) { toast.error('Enter who issued the items'); return }
    setSubmitting(true)
    let success = 0
    const fileName = queue[queueIdx]?.name || `File ${queueIdx + 1}`
    try {
      for (const row of toLog) {
        const { data: item } = await supabase.from('items').select('current_stock').eq('id', row.itemId).single()
        const newStock = Math.max(0, Number(item.current_stock) - Number(row.qty))
        await supabase.from('items').update({ current_stock: newStock }).eq('id', row.itemId)
        await supabase.from('issuances').insert({ item_id:row.itemId, date, quantity_issued:Number(row.qty), issued_by:issuedBy, note:`Scanned issuance (${fileName})` })
        await supabase.from('stock_updates').insert({ item_id:row.itemId, date, quantity_change:-Number(row.qty), new_quantity:newStock, updated_by:issuedBy, note:'Issuance (OCR scan)' })
        success++
      }
      const skipped = rows.filter(r => r.issued && !r.itemId).length
      toast.success(`✅ ${fileName}: logged ${success}${skipped ? ` — ${skipped} unmatched skipped` : ''}`)
      setSubmitting(false)
      advanceQueue({ name: fileName, logged: success, skipped })
    } catch (err) {
      toast.error(err.message)
      setSubmitting(false)
    }
  }

  const resetAll = () => {
    setQueue([]); setQueueIdx(0); setRows([]); setRawOCR('')
    setOversized([]); setSummary([])
    if (fileRef.current) fileRef.current.value = ''
    setStage(STAGES.upload)
  }

  const issuedCount   = rows.filter(r => r.issued).length
  const notIssuedCount= rows.filter(r => !r.issued).length
  const unmatchedCount= rows.filter(r => r.issued && !r.itemId).length
  const matchedIssued = rows.filter(r => r.issued && r.itemId).length
  const totalFiles    = queue.length
  const currentFile   = queue[queueIdx]
  const totalLogged   = summary.reduce((s, x) => s + (x.logged || 0), 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Scan Issuance Form</h1>
          <p className="page-sub">Upload scanned forms — OCR.space reads them automatically</p>
        </div>
        {(stage === STAGES.review || stage === STAGES.done) && (
          <Button variant="secondary" size="sm" onClick={resetAll}>
            <ChevronLeft className="w-4 h-4" /> Start over
          </Button>
        )}
      </div>

      {/* ── Upload ─────────────────────────────────────────────────────── */}
      {stage === STAGES.upload && (
        <div className="space-y-4">
          <div className="bg-blue-900/20 border border-blue-700/30 rounded-lg p-4 text-sm text-blue-300">
            <p className="font-semibold mb-2">📋 How to use</p>
            <ol className="list-decimal ml-4 space-y-1.5">
              <li>On your paper form, <strong>tick ✓ items that were issued</strong></li>
              <li>Scan each form to <strong>PDF or photo</strong> — keep each file under <strong>{MAX_OCR_LABEL}</strong></li>
              <li>You can select <strong>several files at once</strong> — they’re processed one after another</li>
              <li>After each file, <strong>review &amp; confirm the quantities</strong>, then continue to the next</li>
              <li>Files are read in your browser via OCR and <strong>never stored on a server</strong></li>
            </ol>
          </div>

          {oversized.length > 0 && (
            <div className="bg-red-900/20 border border-red-700/40 rounded-lg p-4 text-sm text-red-300">
              <p className="font-semibold flex items-center gap-2 mb-2"><FileWarning className="w-4 h-4" /> File too large — skipped</p>
              <ul className="space-y-1">
                {oversized.map((f, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 bg-red-950/30 rounded px-3 py-1.5">
                    <span className="font-mono truncate">{f.name}</span>
                    <span className="shrink-0 text-red-400 font-semibold">{prettySize(f.size)} &gt; {MAX_OCR_LABEL}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-red-400/80 text-xs">Re-scan at a lower resolution / split the PDF so each file is under {MAX_OCR_LABEL}.</p>
            </div>
          )}

          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files) }}
            className="card border-2 border-dashed border-slate-600 hover:border-teal-500 cursor-pointer transition-all text-center py-14 sm:py-16 hover:bg-teal-900/10"
          >
            <ScanLine className="w-11 h-11 mx-auto mb-3 text-slate-500" />
            <p className="text-base font-semibold text-slate-200">Drop scanned PDFs or images here</p>
            <p className="text-slate-500 text-xs mt-1.5">PDF, JPG, PNG · Multiple files allowed · Max {MAX_OCR_LABEL} per file</p>
            <button className="mt-4 btn-secondary btn-sm mx-auto">
              <Upload className="w-4 h-4" /> Browse Files
            </button>
            <input ref={fileRef} type="file" accept=".pdf,image/*" multiple className="hidden"
              onChange={e => handleFiles(e.target.files)} />
          </div>
        </div>
      )}

      {/* ── Processing ─────────────────────────────────────────────────── */}
      {stage === STAGES.processing && (
        <div className="card text-center py-16">
          <Loader className="w-12 h-12 mx-auto mb-4 text-teal-400 animate-spin" />
          <p className="text-base font-semibold text-slate-100">{progress.label}</p>
          {totalFiles > 1 && (
            <p className="text-teal-400 text-xs mt-1 font-medium">File {queueIdx + 1} of {totalFiles}</p>
          )}
          <div className="mt-5 h-2.5 bg-slate-700 rounded-full overflow-hidden max-w-xs mx-auto">
            <div className="h-full bg-teal-500 rounded-full transition-all duration-300" style={{ width:`${progress.pct}%` }} />
          </div>
          <p className="text-slate-500 text-xs mt-2">{Math.round(progress.pct)}%</p>
        </div>
      )}

      {/* ── Review (per file) ──────────────────────────────────────────── */}
      {stage === STAGES.review && (
        <div className="space-y-3">
          {/* File progress banner */}
          <div className="card-sm flex items-center justify-between gap-3 flex-wrap border border-teal-700/30 bg-teal-900/10">
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="w-4 h-4 text-teal-400 shrink-0" />
              <span className="text-sm font-medium text-slate-200 truncate">{currentFile?.name || 'Scanned form'}</span>
              {currentFile && <span className="text-xs text-slate-500 shrink-0">({prettySize(currentFile.size)})</span>}
            </div>
            {totalFiles > 1 && (
              <span className="text-xs font-semibold text-teal-300 bg-teal-900/40 px-2.5 py-1 rounded-full">
                File {queueIdx + 1} of {totalFiles}
              </span>
            )}
          </div>

          {/* Issuance info */}
          <div className="card grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Date of Issuance" type="date" value={date} onChange={e=>setDate(e.target.value)} />
            <Input label="Issued By *" value={issuedBy} onChange={e=>setIssuedBy(e.target.value)} placeholder="Your name" />
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-2">
            <div className="card-sm text-center border border-teal-700/30"><p className="text-2xl font-bold text-teal-400">{issuedCount}</p><p className="text-[11px] text-slate-400 mt-0.5">✓ Issued</p></div>
            <div className="card-sm text-center border border-red-700/30"><p className="text-2xl font-bold text-red-400">{notIssuedCount}</p><p className="text-[11px] text-slate-400 mt-0.5">✗ Not Issued</p></div>
            <div className="card-sm text-center border border-orange-700/30"><p className="text-2xl font-bold text-orange-400">{unmatchedCount}</p><p className="text-[11px] text-slate-400 mt-0.5">⚠ Unmatched</p></div>
          </div>

          {/* Confirm prompt */}
          <div className="bg-amber-900/15 border border-amber-700/30 rounded-lg p-3 text-sm text-amber-300 flex gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>Check that every <strong>quantity</strong> below is correct, then confirm to log this file and continue.</span>
          </div>

          {/* Review table */}
          <div className="card">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <p className="font-display text-sm font-semibold text-slate-100">Review Items ({rows.length})</p>
              <div className="flex gap-1.5 flex-wrap">
                <button onClick={allIssued}  className="btn-ghost btn-sm text-teal-400">✓ All</button>
                <button onClick={noneIssued} className="btn-ghost btn-sm text-red-400">✗ None</button>
                <button onClick={addRow}     className="btn-secondary btn-sm"><Plus className="w-4 h-4" /> Add</button>
              </div>
            </div>

            <div className="space-y-2 max-h-[55vh] overflow-y-auto pr-1">
              {rows.map((row, idx) => (
                <div key={row.id}
                  className={[
                    'flex items-start gap-2 p-2.5 rounded-lg border transition-all',
                    row.issued ? 'border-teal-700/30 bg-teal-900/10' : 'border-red-700/30 bg-red-900/10 opacity-55',
                  ].join(' ')}>
                  <span className="text-slate-600 text-xs w-4 text-right shrink-0 mt-3">{idx+1}</span>
                  <button onClick={() => toggle(row.id)}
                    className={[
                      'w-9 h-9 rounded-lg flex items-center justify-center shrink-0 font-bold text-lg transition-all mt-0.5',
                      row.issued ? 'bg-teal-600 hover:bg-teal-700 text-white' : 'bg-red-700 hover:bg-red-800 text-white',
                    ].join(' ')}>
                    {row.issued ? '✓' : '✗'}
                  </button>
                  <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div>
                      <p className="text-[10px] text-slate-500 mb-0.5">Part #</p>
                      <input className={`input text-xs py-1.5 font-mono ${!row.matchedFromDB && row.partNumber ? 'border-orange-600 focus:ring-orange-500' : ''}`}
                        value={row.partNumber} onChange={e => updateRow(row.id, 'partNumber', e.target.value.toUpperCase())} placeholder="BEV-001" />
                    </div>
                    <div className="sm:col-span-2">
                      <p className="text-[10px] text-slate-500 mb-0.5">Item Name {!row.matchedFromDB && <span className="text-orange-400 font-medium">· unmatched</span>}</p>
                      <input className={`input text-xs py-1.5 ${!row.matchedFromDB ? 'border-orange-600/50' : ''}`}
                        value={row.name} onChange={e => updateRow(row.id, 'name', e.target.value)} placeholder="Type item name…" />
                    </div>
                    <div>
                      <p className="text-[10px] text-slate-500 mb-0.5">Qty Issued</p>
                      <input type="number" min="0.01" step="0.01" className="input text-xs py-1.5 text-teal-300 font-bold"
                        value={row.qty} onChange={e => updateRow(row.id, 'qty', e.target.value)} />
                    </div>
                  </div>
                  <button onClick={() => delRow(row.id)} className="p-1.5 text-slate-600 hover:text-red-400 transition-colors mt-1 shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {unmatchedCount > 0 && (
            <div className="bg-orange-900/20 border border-orange-700/30 rounded-lg p-3 flex gap-2 text-sm text-orange-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <p><strong>{unmatchedCount}</strong> issued item(s) couldn’t be matched to inventory and will be <strong>skipped</strong>. Fix the Part # to auto-match.</p>
            </div>
          )}

          {rawOCR && (
            <details className="card cursor-pointer">
              <summary className="text-sm text-slate-400 hover:text-slate-200"><FileText className="w-4 h-4 inline mr-1.5" /> View raw OCR text</summary>
              <pre className="mt-3 text-xs text-slate-500 whitespace-pre-wrap font-mono max-h-48 overflow-y-auto leading-relaxed">{rawOCR}</pre>
            </details>
          )}

          {/* Confirm / continue */}
          <div className="flex items-center justify-between gap-3 flex-wrap sticky bottom-0 bg-slate-900/80 backdrop-blur py-2">
            <button onClick={resetAll} className="btn-secondary btn-sm">Discard all</button>
            <Button onClick={confirmAndContinue} loading={submitting} disabled={!matchedIssued}>
              <CheckCircle2 className="w-4 h-4" />
              {queueIdx + 1 < totalFiles
                ? <>Confirm {matchedIssued} & Next file <ArrowRight className="w-4 h-4" /></>
                : <>Confirm &amp; Log {matchedIssued} Issuance{matchedIssued!==1?'s':''}</>}
            </Button>
          </div>
        </div>
      )}

      {/* ── Done summary ───────────────────────────────────────────────── */}
      {stage === STAGES.done && (
        <div className="space-y-4">
          <div className="card text-center py-10">
            <CheckCircle2 className="w-14 h-14 mx-auto mb-3 text-teal-400" />
            <p className="text-lg font-semibold text-slate-100">All files processed</p>
            <p className="text-slate-400 text-sm mt-1">{totalLogged} issuance{totalLogged!==1?'s':''} logged across {summary.length} file{summary.length!==1?'s':''}. Temporary files cleared.</p>
          </div>

          {summary.length > 0 && (
            <div className="card">
              <p className="font-display text-sm font-semibold text-slate-100 mb-3">Per-file summary</p>
              <div className="space-y-1.5">
                {summary.map((s, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 text-sm bg-slate-700/30 rounded-lg px-3 py-2">
                    <span className="truncate text-slate-200 font-medium">{s.name}</span>
                    <span className="shrink-0 text-xs">
                      {s.error
                        ? <span className="text-red-400">Failed — {s.error}</span>
                        : <><span className="text-teal-400 font-semibold">{s.logged} logged</span>{s.skipped ? <span className="text-orange-400"> · {s.skipped} skipped</span> : null}</>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-between gap-3">
            <Button variant="secondary" onClick={resetAll}><Upload className="w-4 h-4" /> Scan more</Button>
            <Button onClick={() => navigate('/issuance')}>View Issuances</Button>
          </div>
        </div>
      )}
    </div>
  )
}
