import { useState, useEffect, useMemo, useRef } from 'react'
import { useSort } from '../hooks/useSort'
import { supabase, selectAll, chunkedWrite } from '../lib/supabase'
import {
  Plus, Search, Upload, X, RefreshCw, CheckCircle2, ClipboardCheck,
  FileSpreadsheet, Loader, Download, Save, AlertTriangle,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Table, { Thead, Tbody, Th, Td, Tr } from '../components/ui/Table'
import Modal from '../components/ui/Modal'
import Input, { Textarea } from '../components/ui/Input'
import CSVImportModal from '../components/CSVImportModal'
import { CSV_CONFIGS } from '../lib/csvTemplates'
import { parseStocktakeFile } from '../lib/stocktakeImport'
import { exportStocktakeVarianceExcel } from '../lib/excelExport'

const today = () => new Date().toISOString().split('T')[0]
const EMPTY = { date: today(), item_id: '', counted_quantity: '', note: '' }
const cleanCode = (s) => String(s ?? '').replace(/\.0$/, '').replace(/^0+/, '').trim()

export default function Stocktake() {
  const [tab, setTab] = useState('analyze')   // 'analyze' | 'counts'
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Stocktake</h1>
          <p className="page-sub">Upload a physical count, analyse variances vs system stock, then approve adjustments</p>
        </div>
        <div className="flex gap-1 bg-slate-800 border border-slate-700 rounded-xl p-1">
          <button onClick={() => setTab('analyze')}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === 'analyze' ? 'bg-teal-600 text-white' : 'text-slate-400 hover:text-slate-100'}`}>
            <FileSpreadsheet className="w-4 h-4 inline mr-1.5" />Upload & Analyse
          </button>
          <button onClick={() => setTab('counts')}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === 'counts' ? 'bg-teal-600 text-white' : 'text-slate-400 hover:text-slate-100'}`}>
            <ClipboardCheck className="w-4 h-4 inline mr-1.5" />Count Entries
          </button>
        </div>
      </div>
      {tab === 'analyze' ? <AnalyzeFlow /> : <CountEntries />}
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// UPLOAD & ANALYSE — parse a physical-count file, compare vs system stock and
// render a coloured variance report (also exportable to a styled Excel file).
// ═════════════════════════════════════════════════════════════════════════════
function AnalyzeFlow() {
  const [busy, setBusy]       = useState(false)
  const [items, setItems]     = useState([])
  const [report, setReport]   = useState(null)  // { label, date, rows }
  const [search, setSearch]   = useState('')
  const [onlyVar, setOnlyVar] = useState(false)
  const [saving, setSaving]   = useState(false)
  const fileRef = useRef(null)

  useEffect(() => {
    selectAll(() => supabase.from('items').select('id,name,part_number,unit,current_stock,unit_cost').eq('active', true))
      .then(({ data }) => setItems(data || []))
  }, [])
  const byCode = useMemo(() => {
    const m = new Map(); for (const it of items) m.set(cleanCode(it.part_number), it); return m
  }, [items])

  const handleFile = async (fileList) => {
    const file = fileList?.[0]; if (!file) return
    setBusy(true)
    try {
      const { rows: counted, error } = await parseStocktakeFile(file)
      if (error || !counted.length) { toast.error(error || 'No rows found'); setBusy(false); return }
      const rows = counted.map(c => {
        const it = byCode.get(cleanCode(c.part_number))
        const system = it ? Number(it.current_stock) || 0 : null
        const variance = it ? (c.counted_qty - system) : null
        const cost = it ? Number(it.unit_cost) || 0 : 0
        return {
          part_number: c.part_number,
          item_id: it?.id || null,
          item_name: it?.name || c.name || '(unmatched)',
          unit: it?.unit || '',
          system_qty: system,
          counted_qty: c.counted_qty,
          variance,
          variance_pct: (it && system > 0) ? Math.round((variance / system) * 1000) / 10 : (it && variance === 0 ? 0 : null),
          variance_value: it ? Math.round(variance * cost * 100) / 100 : null,
          matched: !!it,
        }
      })
      // sort: biggest absolute variance first, unmatched last
      rows.sort((a, b) => {
        if (a.matched !== b.matched) return a.matched ? -1 : 1
        return Math.abs(b.variance ?? 0) - Math.abs(a.variance ?? 0)
      })
      setReport({ label: file.name.replace(/\.[^.]+$/, ''), date: today(), rows })
      const var0 = rows.filter(r => r.matched && r.variance !== 0).length
      toast.success(`Analysed ${rows.length} items · ${var0} with variance`)
    } catch (e) { toast.error(e.message) }
    setBusy(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const filtered = useMemo(() => {
    if (!report) return []
    let list = report.rows
    if (onlyVar) list = list.filter(r => r.matched && r.variance !== 0)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(r => r.item_name.toLowerCase().includes(q) || (r.part_number || '').toLowerCase().includes(q))
    }
    return list
  }, [report, onlyVar, search])

  const stats = useMemo(() => {
    if (!report) return null
    const r = report.rows
    return {
      total: r.length,
      matched: r.filter(x => x.matched).length,
      unmatched: r.filter(x => !x.matched).length,
      short: r.filter(x => x.matched && x.variance < 0).length,
      over: r.filter(x => x.matched && x.variance > 0).length,
      match: r.filter(x => x.matched && x.variance === 0).length,
      valueImpact: Math.round(r.reduce((s, x) => s + (x.variance_value || 0), 0) * 100) / 100,
    }
  }, [report])

  const exportExcel = async () => {
    if (!report) return
    try {
      await exportStocktakeVarianceExcel(report.rows.filter(r => r.matched), {
        sessionLabel: report.label, date: report.date,
        filename: `Stocktake_Variance_${report.label.replace(/\s+/g, '_')}.xlsx`,
      })
      toast.success('Excel downloaded')
    } catch (e) { toast.error(e.message) }
  }

  // Persist the analysed counts to stocktake_entries so they can be approved.
  const saveToEntries = async () => {
    if (!report) return
    const matched = report.rows.filter(r => r.matched)
    if (!matched.length) { toast.error('No matched items to save'); return }
    setSaving(true)
    const sessionId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`
    const payload = matched.map(r => ({
      item_id: r.item_id, item_name: r.item_name, date: report.date,
      counted_quantity: r.counted_qty, system_quantity: r.system_qty,
      difference: r.variance, unit: r.unit, status: 'pending',
      session_id: sessionId, session_label: report.label, variance_value: r.variance_value || 0,
      note: 'From uploaded stocktake',
    }))
    const { failed } = await chunkedWrite('stocktake_entries', payload, { mode: 'insert' })
    if (failed) toast.error(`${failed} rows failed to save`)
    else toast.success(`Saved ${payload.length} count entries — approve them in "Count Entries"`)
    setSaving(false)
  }

  if (!report) {
    return (
      <div className="space-y-4">
        <div className="bg-blue-900/20 border border-blue-700/30 rounded-lg p-4 text-sm text-blue-300">
          <p className="font-semibold mb-2">📋 How it works</p>
          <ol className="list-decimal ml-4 space-y-1.5">
            <li>Upload your physical-count file (<strong>.xlsx</strong> or <strong>.csv</strong>) — it needs an item <strong>code/part #</strong> column and a <strong>counted quantity</strong> column.</li>
            <li>The system matches each code to inventory and computes the <strong>variance</strong> vs system stock.</li>
            <li>Review the coloured <strong>variance report</strong> on screen, <strong>download the Excel</strong>, and optionally save the counts for approval.</li>
          </ol>
        </div>
        <div onClick={() => fileRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files) }}
          className="card border-2 border-dashed border-slate-600 hover:border-teal-500 cursor-pointer transition-all text-center py-16 hover:bg-teal-900/10">
          {busy ? <Loader className="w-11 h-11 mx-auto mb-3 text-teal-400 animate-spin" />
                : <FileSpreadsheet className="w-11 h-11 mx-auto mb-3 text-slate-500" />}
          <p className="text-base font-semibold text-slate-200">Drop a stocktake count file here</p>
          <p className="text-slate-500 text-xs mt-1.5">Excel (.xlsx) or CSV · needs Code + Counted Qty columns</p>
          <button className="mt-4 btn-secondary btn-sm mx-auto"><Upload className="w-4 h-4" /> Browse File</button>
          <input ref={fileRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={e => handleFile(e.target.files)} />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Action bar */}
      <div className="card-sm flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-slate-300 text-sm font-medium">{report.label}</span>
          <Badge variant="teal">{report.rows.length} items</Badge>
          <span className="text-xs text-slate-500">{report.date}</span>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="secondary" onClick={() => { setReport(null); setSearch(''); setOnlyVar(false) }}>
            <Upload className="w-4 h-4" /> New Upload
          </Button>
          <Button variant="secondary" onClick={saveToEntries} loading={saving}><Save className="w-4 h-4" /> Save for Approval</Button>
          <Button onClick={exportExcel}><Download className="w-4 h-4" /> Download Excel</Button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          <div className="card-sm text-center"><p className="text-2xl font-bold text-[#00AEEF]">{stats.total}</p><p className="text-slate-400 text-xs mt-1">Items</p></div>
          <div className="card-sm text-center"><p className="text-2xl font-bold text-green-400">{stats.match}</p><p className="text-slate-400 text-xs mt-1">Match</p></div>
          <div className="card-sm text-center border border-red-700/30 bg-red-900/10"><p className="text-2xl font-bold text-red-400">{stats.short}</p><p className="text-slate-400 text-xs mt-1">Shortage</p></div>
          <div className="card-sm text-center border border-blue-700/30 bg-blue-900/10"><p className="text-2xl font-bold text-blue-400">{stats.over}</p><p className="text-slate-400 text-xs mt-1">Surplus</p></div>
          <div className="card-sm text-center border border-orange-700/30 bg-orange-900/10"><p className="text-2xl font-bold text-orange-400">{stats.unmatched}</p><p className="text-slate-400 text-xs mt-1">Unmatched</p></div>
          <div className="card-sm text-center"><p className={`text-lg font-bold ${stats.valueImpact < 0 ? 'text-red-400' : 'text-teal-400'}`}>{stats.valueImpact}</p><p className="text-slate-400 text-xs mt-1">Value Impact</p></div>
        </div>
      )}

      {/* Filters */}
      <div className="card py-3 px-4 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input className="input text-sm pl-9" placeholder="Search item or code…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
          <input type="checkbox" checked={onlyVar} onChange={e => setOnlyVar(e.target.checked)} className="accent-teal-500 w-4 h-4" />
          Only show variances
        </label>
      </div>

      {/* Variance table */}
      <div className="card p-0 overflow-x-auto">
        <Table>
          <Thead><tr>
            <Th>Code</Th><Th>Item</Th><Th>Unit</Th><Th>System</Th><Th>Counted</Th><Th>Variance</Th><Th>Var %</Th><Th>Value</Th><Th>Result</Th>
          </tr></Thead>
          <Tbody>
            {filtered.length === 0 ? (
              <Tr><Td colSpan={9} className="text-center text-slate-500 py-12">No rows match</Td></Tr>
            ) : filtered.map((r, i) => {
              const v = r.variance
              const cls = !r.matched ? 'text-orange-400' : v === 0 ? 'text-green-400' : v < 0 ? 'text-red-400' : 'text-blue-400'
              return (
                <Tr key={i} className={!r.matched ? 'bg-orange-900/5' : v < 0 ? 'bg-red-900/5' : v > 0 ? 'bg-blue-900/5' : ''}>
                  <Td className="font-mono text-xs text-[#00AEEF]">{r.part_number}</Td>
                  <Td className="font-medium text-slate-100 text-sm">{r.item_name}</Td>
                  <Td className="text-slate-400 text-xs">{r.unit}</Td>
                  <Td className="text-slate-300">{r.system_qty ?? '—'}</Td>
                  <Td className="font-bold text-[#00AEEF]">{r.counted_qty}</Td>
                  <Td><span className={`font-bold text-sm ${cls}`}>{r.matched ? (v >= 0 ? '+' : '') + v : '—'}</span></Td>
                  <Td className="text-slate-400 text-xs">{r.variance_pct == null ? '—' : `${r.variance_pct}%`}</Td>
                  <Td className="text-slate-400 text-xs">{r.variance_value == null ? '—' : r.variance_value}</Td>
                  <Td>{!r.matched ? <Badge variant="orange">unmatched</Badge> : v === 0 ? <Badge variant="green">match</Badge> : v < 0 ? <Badge variant="red">shortage</Badge> : <Badge variant="blue">surplus</Badge>}</Td>
                </Tr>
              )
            })}
          </Tbody>
        </Table>
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// COUNT ENTRIES — manual single-item counts + approval (the original flow).
// ═════════════════════════════════════════════════════════════════════════════
function CountEntries() {
  const [records, setRecords] = useState([])
  const [items,   setItems]   = useState([])
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [showCSV, setShowCSV] = useState(false)
  const [form,    setForm]    = useState(EMPTY)
  const [saving,  setSaving]  = useState(false)
  const [approvingId, setApprovingId] = useState(null)
  const [itemSearch, setItemSearch]   = useState('')
  const [showItemDrop, setShowItemDrop] = useState(false)

  const load = async () => {
    setLoading(true)
    const [{ data: r }, { data: i }] = await Promise.all([
      supabase.from('stocktake_entries').select('*,items(name,part_number,unit)').order('date', { ascending: false }).limit(300),
      selectAll(() => supabase.from('items').select('id,name,part_number,unit,current_stock').eq('active', true).order('name')),
    ])
    setRecords(r || []); setItems(i || []); setLoading(false)
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => records.filter(r =>
    !search ||
    r.item_name?.toLowerCase().includes(search.toLowerCase()) ||
    r.items?.name?.toLowerCase().includes(search.toLowerCase())
  ), [records, search])

  const { sorted, thProps } = useSort(filtered, 'date', 'desc')

  const filteredItems = items.filter(i =>
    i.name.toLowerCase().includes(itemSearch.toLowerCase()) ||
    i.part_number.toLowerCase().includes(itemSearch.toLowerCase())
  ).slice(0, 8)

  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))
  const selectedItem = items.find(i => i.id === form.item_id)

  const handleSave = async () => {
    if (!form.item_id)           { toast.error('Select an item'); return }
    if (form.counted_quantity === '') { toast.error('Enter counted quantity'); return }
    setSaving(true)
    const item = items.find(i => i.id === form.item_id)
    const diff = Number(form.counted_quantity) - Number(item?.current_stock || 0)
    const { error } = await supabase.from('stocktake_entries').insert({
      item_id:          form.item_id,
      item_name:        item?.name || '',
      date:             form.date,
      counted_quantity: Number(form.counted_quantity),
      system_quantity:  Number(item?.current_stock || 0),
      difference:       diff,
      unit:             item?.unit || 'pcs',
      note:             form.note,
      status:           'pending',
    })
    if (error) { toast.error(error.message); setSaving(false); return }
    toast.success('Stocktake entry saved'); setShowAdd(false); setForm(EMPTY); setItemSearch(''); load(); setSaving(false)
  }

  const approveEntry = async (entry) => {
    if (!confirm(`Approve? This will update stock from ${entry.system_quantity} to ${entry.counted_quantity} ${entry.unit}.`)) return
    setApprovingId(entry.id)
    await supabase.from('items').update({ current_stock: entry.counted_quantity }).eq('id', entry.item_id)
    await supabase.from('stock_updates').insert({
      item_id: entry.item_id, date: entry.date,
      quantity_change: entry.difference,
      new_quantity: entry.counted_quantity,
      updated_by: 'Stocktake', note: `Stocktake adjustment: ${entry.difference >= 0 ? '+' : ''}${entry.difference}`
    }).catch(() => {})
    await supabase.from('stocktake_entries').update({ status: 'approved' }).eq('id', entry.id)
    toast.success('Stock updated from stocktake'); load(); setApprovingId(null)
  }

  const pendingCount = records.filter(r => r.status === 'pending').length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end flex-wrap gap-3">
        <div className="flex gap-2 flex-wrap">
          <button onClick={load} className="btn-ghost btn-sm"><RefreshCw className="w-4 h-4" /></button>
          <button onClick={() => setShowCSV(true)} className="btn-secondary btn-sm"><Upload className="w-4 h-4" /> Import CSV</button>
          <Button onClick={() => { setShowAdd(true); setForm(EMPTY); setItemSearch('') }}><Plus className="w-4 h-4" /> Add Count</Button>
        </div>
      </div>

      {pendingCount > 0 && (
        <div className="card border border-yellow-700/30 bg-yellow-900/10 flex items-center gap-3">
          <ClipboardCheck className="w-5 h-5 text-yellow-400 shrink-0" />
          <p className="text-sm text-yellow-300"><strong>{pendingCount}</strong> stocktake entr{pendingCount !== 1 ? 'ies' : 'y'} pending approval. Review below and click ✓ to update stock.</p>
        </div>
      )}

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input placeholder="Search item…" value={search} onChange={e => setSearch(e.target.value)} className="input pl-9 text-sm" />
        {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2"><X className="w-4 h-4 text-slate-400" /></button>}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-10 h-10 border-4 border-[#00AEEF] border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="card overflow-x-auto">
          <Table>
            <Thead><tr>
              <Th {...thProps('date')}>Date</Th><Th {...thProps('items.part_number')}>Part #</Th><Th {...thProps('item_name')}>Item</Th><Th {...thProps('system_quantity')}>System Qty</Th><Th {...thProps('counted_quantity')}>Counted</Th><Th>Difference</Th><Th {...thProps('status')}>Status</Th><Th>Action</Th>
            </tr></Thead>
            <Tbody>
              {sorted.length === 0 ? (
                <Tr><Td colSpan={8} className="text-center text-slate-500 py-12">No stocktake entries yet</Td></Tr>
              ) : sorted.map(r => {
                const diff = Number(r.counted_quantity) - Number(r.system_quantity)
                return (
                  <Tr key={r.id} className={r.status === 'pending' ? 'bg-yellow-900/5' : ''}>
                    <Td className="text-slate-300 text-xs whitespace-nowrap">{r.date}</Td>
                    <Td className="font-mono text-xs text-slate-400">{r.items?.part_number}</Td>
                    <Td className="font-medium text-slate-100">{r.item_name || r.items?.name}</Td>
                    <Td className="text-slate-300">{r.system_quantity} <span className="text-slate-500 text-xs">{r.unit}</span></Td>
                    <Td className="font-bold text-[#00AEEF]">{r.counted_quantity} <span className="text-slate-500 text-xs font-normal">{r.unit}</span></Td>
                    <Td>
                      <span className={`font-bold text-sm ${diff > 0 ? 'text-green-400' : diff < 0 ? 'text-red-400' : 'text-slate-400'}`}>
                        {diff >= 0 ? '+' : ''}{diff}
                      </span>
                    </Td>
                    <Td><Badge variant={r.status === 'approved' ? 'green' : r.status === 'rejected' ? 'red' : 'yellow'}>{r.status}</Badge></Td>
                    <Td>
                      {r.status === 'pending' && r.item_id && (
                        <button onClick={() => approveEntry(r)} disabled={approvingId === r.id}
                          className="flex items-center gap-1 text-xs font-medium text-green-400 hover:text-green-300 bg-green-900/20 hover:bg-green-900/40 px-2.5 py-1.5 rounded-lg transition-colors">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                        </button>
                      )}
                    </Td>
                  </Tr>
                )
              })}
            </Tbody>
          </Table>
        </div>
      )}

      {showAdd && (
        <Modal isOpen onClose={() => setShowAdd(false)} title="Add Stocktake Count" size="sm"
          footer={<><Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button><Button onClick={handleSave} loading={saving}>Save Count</Button></>}>
          <div className="space-y-4">
            <Input label="Date *" type="date" value={form.date} onChange={f('date')} />
            <div className="relative">
              <label className="block text-sm font-medium text-slate-300 mb-1">Item *</label>
              {selectedItem ? (
                <div className="input bg-slate-700/50 flex items-center gap-2">
                  <span className="font-mono text-xs text-[#00AEEF]">{selectedItem.part_number}</span>
                  <span className="flex-1 text-slate-100">{selectedItem.name}</span>
                  <span className="text-slate-400 text-xs">System: {selectedItem.current_stock} {selectedItem.unit}</span>
                  <button onClick={() => { setForm(p => ({...p, item_id:''})); setItemSearch('') }}><X className="w-4 h-4 text-slate-400" /></button>
                </div>
              ) : (
                <input className="input text-sm" placeholder="Search item…" value={itemSearch}
                  onChange={e => { setItemSearch(e.target.value); setShowItemDrop(true) }}
                  onFocus={() => setShowItemDrop(true)} />
              )}
              {showItemDrop && !selectedItem && filteredItems.length > 0 && (
                <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-600 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                  {filteredItems.map(item => (
                    <button key={item.id} onClick={() => { setForm(p => ({...p, item_id: item.id})); setItemSearch(''); setShowItemDrop(false) }}
                      className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-slate-700 text-left text-sm">
                      <span className="font-mono text-xs text-[#00AEEF] w-20 shrink-0">{item.part_number}</span>
                      <span className="flex-1 text-slate-200 truncate">{item.name}</span>
                      <span className="text-slate-400 text-xs">{item.current_stock} {item.unit}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Input label="Physical Count *" type="number" min="0" step="0.01" value={form.counted_quantity} onChange={f('counted_quantity')}
              placeholder={selectedItem ? `System shows ${selectedItem.current_stock} ${selectedItem.unit}` : 'Count what you physically see'} />
            {selectedItem && form.counted_quantity !== '' && (
              <div className={`text-sm p-2.5 rounded-lg ${Number(form.counted_quantity) === Number(selectedItem.current_stock) ? 'bg-green-900/20 text-green-400' : 'bg-orange-900/20 text-orange-300'}`}>
                Difference: <strong>{(Number(form.counted_quantity) - Number(selectedItem.current_stock) >= 0 ? '+' : '')}{Number(form.counted_quantity) - Number(selectedItem.current_stock)} {selectedItem.unit}</strong>
              </div>
            )}
            <Textarea label="Note" value={form.note} onChange={f('note')} rows={2} placeholder="e.g. Counted twice, confirmed accurate" />
          </div>
        </Modal>
      )}

      {showCSV && <CSVImportModal config={CSV_CONFIGS.stocktake} onClose={() => setShowCSV(false)} onImported={load} />}
    </div>
  )
}
