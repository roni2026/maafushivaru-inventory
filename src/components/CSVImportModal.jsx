// CSVImportModal.jsx
// Universal CSV import modal — works for ALL pages.
// Pass a config from csvTemplates.js and it handles everything.

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { generateCSV, parseCSV } from '../lib/csvTemplates'
import { Download, Upload, CheckCircle2, X, FileText, AlertCircle, Loader } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from './ui/Modal'
import Button from './ui/Button'

const STEPS = ['Template', 'Upload', 'Preview', 'Done']

export default function CSVImportModal({ config, onClose, onImported }) {
  const [step,      setStep]     = useState(0) // 0=template 1=upload 2=preview 3=done
  const [lookups,   setLookups]  = useState({})
  const [rows,      setRows]     = useState([])
  const [importing, setImporting]= useState(false)
  const [loadingLookups, setLoadingLookups] = useState(true)
  const [results,   setResults]  = useState(null)
  const [fileName,  setFileName] = useState('')
  const fileRef = useRef(null)

  // Load lookup tables (stores, items) once on mount
  useEffect(() => {
    async function load() {
      const loaded = {}
      const needs = config.lookups || []
      await Promise.all(needs.map(async (lk) => {
        if (lk === 'stores') {
          const { data } = await supabase.from('stores').select('*')
          loaded.stores = data || []
        }
        if (lk === 'items') {
          const { data } = await supabase.from('items').select('*,stores(name)')
          loaded.items = data || []
        }
      }))
      setLookups(loaded)
      setLoadingLookups(false)
    }
    load()
  }, [config])

  const downloadTemplate = () => {
    const csv = generateCSV(config)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    a.download = `${config.label.toLowerCase().replace(/[\s/()]+/g, '_')}_template.csv`
    a.click()
    toast.success(`${config.label} template downloaded`)
  }

  const handleFile = (file) => {
    if (!file) return
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target.result
      const rawRows = parseCSV(text)
      if (!rawRows.length) {
        toast.error('No data rows found. Make sure the file has a header row and at least one data row.')
        return
      }
      const processed = rawRows
        .filter(r => Object.values(r).some(v => v?.trim()))
        .map((raw, idx) => {
          let transformed = {}
          let errors = []
          try {
            transformed = config.transform(raw, lookups)
            errors = config.validate(raw, lookups)
          } catch (err) {
            errors = ['Parse error: ' + err.message]
          }
          return {
            _rowNum:       idx + 2,
            _raw:          raw,
            _transformed:  transformed,
            _errors:       errors,
            _valid:        errors.length === 0,
            _preview:      Object.values(raw).slice(0, 4).filter(v => v).join(' · '),
          }
        })
      setRows(processed)
      setStep(2)
    }
    reader.readAsText(file)
  }

  // Special handler for order_items — groups by delivery date and creates order_history first
  const importOrderItems = async (valid) => {
    const byDate = {}
    valid.forEach(r => {
      const d = r._transformed._delivery_date
      if (!byDate[d]) byDate[d] = []
      byDate[d].push(r._transformed)
    })
    let success = 0; let failed = 0
    for (const [date, items] of Object.entries(byDate)) {
      try {
        const dayName = items[0]._delivery_day || new Date(date).toLocaleDateString('en-US',{weekday:'long'})
        const { data: order } = await supabase.from('order_history').insert({
          delivery_date: date, delivery_day: dayName, status: 'pending', created_by: 'CSV Import',
        }).select().single()
        const orderItems = items.map(({ _delivery_date, _delivery_day, ...rest }) => ({
          ...rest, order_id: order.id,
        }))
        const { error } = await supabase.from('order_history_items').insert(orderItems)
        if (!error) success += items.length
        else { failed += items.length; console.error(error) }
      } catch (err) { failed += items.length; console.error(err) }
    }
    return { success, failed }
  }

  const handleImport = async () => {
    setImporting(true)
    const valid = rows.filter(r => r._valid)
    let success = 0; let failed = 0

    try {
      if (config.table === 'order_history_items') {
        const res = await importOrderItems(valid)
        success = res.success; failed = res.failed
      } else {
        for (const row of valid) {
          const payload = { ...row._transformed }
          // Remove internal _ prefixed keys
          Object.keys(payload).forEach(k => { if (k.startsWith('_')) delete payload[k] })

          const { error } = config.upsertOn
            ? await supabase.from(config.table).upsert(payload, { onConflict: config.upsertOn })
            : await supabase.from(config.table).insert(payload)

          if (!error) success++
          else { failed++; console.error(error) }
        }
      }
    } catch (err) {
      toast.error('Import error: ' + err.message)
    }

    setResults({ success, failed, skipped: rows.filter(r => !r._valid).length })
    setStep(3)
    if (success > 0) onImported?.()
    setImporting(false)
  }

  const valid   = rows.filter(r => r._valid)
  const invalid = rows.filter(r => !r._valid)

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`${config.icon} Import ${config.label}`}
      size="lg"
      footer={
        step === 0 ? (
          <>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={() => setStep(1)}>Next: Upload File →</Button>
          </>
        ) : step === 1 ? (
          <Button variant="secondary" onClick={() => setStep(0)}>← Back</Button>
        ) : step === 2 ? (
          <>
            <Button variant="secondary" onClick={() => { setStep(1); setRows([]) }}>← Re-upload</Button>
            <Button onClick={handleImport} disabled={!valid.length || importing} loading={importing}>
              Import {valid.length} Row{valid.length !== 1 ? 's' : ''}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>✓ Done</Button>
        )
      }
    >
      {/* ── Step indicator ─────────────────────────── */}
      <div className="flex items-center gap-1 mb-6">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-1 flex-1">
            <div className="flex items-center gap-1.5">
              <div className={[
                'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-all',
                step === i   ? 'bg-[#00AEEF] text-white scale-110' :
                step  > i    ? 'bg-green-600 text-white' :
                               'bg-slate-700 text-slate-400',
              ].join(' ')}>
                {step > i ? '✓' : i + 1}
              </div>
              <span className={`text-xs hidden sm:block ${step === i ? 'text-[#00AEEF] font-medium' : step > i ? 'text-green-400' : 'text-slate-500'}`}>
                {s}
              </span>
            </div>
            {i < STEPS.length - 1 && <div className="flex-1 h-px bg-slate-700 mx-1" />}
          </div>
        ))}
      </div>

      {/* ── STEP 0: Template download ───────────────── */}
      {step === 0 && (
        <div className="space-y-5">
          <div className="bg-blue-900/20 border border-blue-700/30 rounded-xl p-4 text-sm text-blue-300">
            <p className="font-semibold text-blue-200 mb-2">📋 How to bulk import {config.label}:</p>
            <ol className="list-decimal ml-4 space-y-1.5">
              <li>Download the template below</li>
              <li>Open in <strong>Excel, Google Sheets, or any spreadsheet app</strong></li>
              <li>Fill in your data (sample rows show the correct format)</li>
              <li>Save as <strong>CSV (.csv)</strong></li>
              <li>Come back and upload on the next step</li>
            </ol>
            {config.notes && (
              <p className="mt-3 text-yellow-300 bg-yellow-900/20 rounded-lg p-2 text-xs">⚠ {config.notes}</p>
            )}
          </div>

          {/* Column reference */}
          <div className="bg-slate-800/60 rounded-xl border border-slate-700/40 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-700/40 flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-200">Column Reference</p>
              <span className="text-xs text-slate-500">{config.headers.length} columns</span>
            </div>
            <div className="p-4 space-y-2 max-h-56 overflow-y-auto">
              {config.headers.map(h => (
                <div key={h} className="flex gap-3 text-xs">
                  <span className="font-mono text-[#00AEEF] w-36 shrink-0">
                    {h}
                    {config.required?.includes(h) && <span className="text-red-400 ml-1">*</span>}
                  </span>
                  <span className="text-slate-400">{config.descriptions?.[h] || '—'}</span>
                </div>
              ))}
            </div>
            <div className="px-4 py-2 border-t border-slate-700/40">
              <p className="text-xs text-slate-500">* = required field</p>
            </div>
          </div>

          <button
            onClick={downloadTemplate}
            className="w-full flex items-center justify-center gap-3 py-4 bg-[#00AEEF]/10 hover:bg-[#00AEEF]/20 border-2 border-[#00AEEF]/40 hover:border-[#00AEEF] rounded-xl transition-all text-[#00AEEF] font-semibold"
          >
            <Download className="w-5 h-5" />
            Download {config.label} Template (.csv)
          </button>
        </div>
      )}

      {/* ── STEP 1: Upload ──────────────────────────── */}
      {step === 1 && (
        <div className="space-y-4">
          {loadingLookups ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader className="w-8 h-8 text-[#00AEEF] animate-spin" />
              <p className="text-slate-400 text-sm">Loading reference data…</p>
            </div>
          ) : (
            <>
              <div
                onClick={() => fileRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]) }}
                className="border-2 border-dashed border-slate-600 hover:border-[#00AEEF] rounded-xl p-14 text-center cursor-pointer transition-all hover:bg-[#00AEEF]/5 group"
              >
                <Upload className="w-12 h-12 mx-auto mb-4 text-slate-500 group-hover:text-[#00AEEF] transition-colors" />
                <p className="font-semibold text-slate-200 text-lg">Drop your CSV file here</p>
                <p className="text-slate-500 text-sm mt-1.5">or click to browse</p>
                <p className="text-slate-600 text-xs mt-3">Only .csv files · Use the template from Step 1</p>
                <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden"
                  onChange={e => handleFile(e.target.files?.[0])} />
              </div>
              <div className="bg-slate-700/30 rounded-xl p-3 text-xs text-slate-400">
                <p className="font-medium text-slate-300 mb-1.5">✅ Accepted format rules:</p>
                <ul className="space-y-1">
                  <li>• Lines starting with <code className="text-slate-300">#</code> are treated as comments and ignored</li>
                  <li>• First non-comment line = header row (column names)</li>
                  <li>• Fields with commas must be wrapped in double quotes: <code className="text-slate-300">"rice, flour, pasta"</code></li>
                  <li>• Dates must be in <strong className="text-slate-300">YYYY-MM-DD</strong> format (e.g. 2026-06-17)</li>
                  <li>• Empty rows are automatically skipped</li>
                </ul>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── STEP 2: Preview ─────────────────────────── */}
      {step === 2 && (
        <div className="space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-slate-700/30 rounded-xl p-3 text-center border border-slate-700/40">
              <p className="text-2xl font-bold text-slate-100">{rows.length}</p>
              <p className="text-slate-400 text-xs mt-1">Total Rows</p>
              {fileName && <p className="text-slate-600 text-[10px] mt-1 truncate">{fileName}</p>}
            </div>
            <div className="bg-green-900/20 border border-green-700/30 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-green-400">{valid.length}</p>
              <p className="text-slate-400 text-xs mt-1">Ready to Import</p>
            </div>
            <div className={`rounded-xl p-3 text-center border ${invalid.length > 0 ? 'bg-red-900/20 border-red-700/30' : 'bg-slate-700/20 border-slate-700/40'}`}>
              <p className={`text-2xl font-bold ${invalid.length > 0 ? 'text-red-400' : 'text-slate-500'}`}>{invalid.length}</p>
              <p className="text-slate-400 text-xs mt-1">Errors (skipped)</p>
            </div>
          </div>

          {/* Row list */}
          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-0.5">
            {rows.map((row) => (
              <div key={row._rowNum}
                className={`flex items-start gap-2.5 p-2.5 rounded-xl border text-xs transition-colors ${row._valid ? 'border-green-700/30 bg-green-900/10' : 'border-red-700/30 bg-red-900/10'}`}>
                <div className={`w-6 h-6 rounded-full shrink-0 flex items-center justify-center font-bold text-[10px] ${row._valid ? 'bg-green-600 text-white' : 'bg-red-700 text-white'}`}>
                  {row._valid ? '✓' : '✗'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 shrink-0">Row {row._rowNum}</span>
                    <span className="text-slate-200 truncate">{row._preview}</span>
                  </div>
                  {!row._valid && (
                    <p className="text-red-400 mt-1">{row._errors.join(' · ')}</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {invalid.length > 0 && (
            <div className="bg-orange-900/20 border border-orange-700/30 rounded-xl p-3 text-sm text-orange-300 flex gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <p>
                <strong>{invalid.length} row{invalid.length !== 1 ? 's' : ''}</strong> have errors and will be skipped.
                Fix them in your CSV and re-upload, or click Import to proceed with the {valid.length} valid rows.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── STEP 3: Done ────────────────────────────── */}
      {step === 3 && results && (
        <div className="text-center py-8 space-y-5">
          <CheckCircle2 className="w-16 h-16 text-green-400 mx-auto" />
          <div>
            <p className="text-xl font-bold text-slate-100">Import Complete</p>
            <p className="text-slate-400 text-sm mt-1">{config.label} data has been saved to the database.</p>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-4 max-w-xs mx-auto">
            <div className="bg-green-900/20 border border-green-700/30 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-green-400">{results.success}</p>
              <p className="text-slate-400 text-xs mt-1">Imported</p>
            </div>
            <div className="bg-red-900/20 border border-red-700/30 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-red-400">{results.failed}</p>
              <p className="text-slate-400 text-xs mt-1">DB Failed</p>
            </div>
            <div className="bg-orange-900/20 border border-orange-700/30 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-orange-400">{results.skipped}</p>
              <p className="text-slate-400 text-xs mt-1">Skipped</p>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
