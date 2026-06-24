import { useState, useEffect, useMemo } from 'react'
import { supabase, selectAll } from '../lib/supabase'
import { Plus, Search, Trash2, Upload, X, RefreshCw, ChevronDown, ChevronRight, MapPin, FileText } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Table, { Thead, Tbody, Th, Td, Tr } from '../components/ui/Table'
import Modal from '../components/ui/Modal'
import Input, { Textarea } from '../components/ui/Input'
import CSVImportModal from '../components/CSVImportModal'
import { CSV_CONFIGS } from '../lib/csvTemplates'

const today = () => new Date().toISOString().split('T')[0]

const EMPTY = { date: today(), item_id: '', quantity_issued: '', issued_by: 'Roni', note: '' }

export default function Issuance() {
  const [records, setRecords] = useState([])
  const [reqMap,  setReqMap]  = useState({})   // requisition_id -> requisition header
  const [items,   setItems]   = useState([])
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')
  const [range,   setRange]   = useState({ from: '', to: '' })
  const [expanded, setExpanded] = useState({}) // requisition_id -> bool
  const [showAdd, setShowAdd] = useState(false)
  const [showCSV, setShowCSV] = useState(false)
  const [form,    setForm]    = useState(EMPTY)
  const [saving,  setSaving]  = useState(false)
  const [itemSearch, setItemSearch] = useState('')
  const [showItemDrop, setShowItemDrop] = useState(false)

  const load = async () => {
    setLoading(true)
    let iq = supabase.from('issuances').select('*,items(name,part_number,unit)')
      .order('date', { ascending: false }).order('created_at', { ascending: false }).limit(800)
    if (range.from) iq = iq.gte('date', range.from)
    if (range.to)   iq = iq.lte('date', range.to)
    const [{ data: r }, { data: i }] = await Promise.all([
      iq,
      selectAll(() => supabase.from('items').select('id,name,part_number,unit,current_stock').eq('active', true).order('name')),
    ])
    const recs = r || []
    setRecords(recs)
    setItems(i || [])
    // pull the requisition headers so we can group scanned issuances by destination
    const reqIds = [...new Set(recs.map(x => x.requisition_id).filter(Boolean))]
    if (reqIds.length) {
      const { data: reqs } = await supabase.from('requisitions')
        .select('id,req_number,destination_location,source_location,subject,department,date,requestor,purchase_type')
        .in('id', reqIds)
      const map = {}; (reqs || []).forEach(q => { map[q.id] = q }); setReqMap(map)
    } else setReqMap({})
    setLoading(false)
  }
  useEffect(() => { load() }, [range.from, range.to])

  // search across item, part #, issued-by, req number, destination & subject
  const filtered = useMemo(() => records.filter(r => {
    if (!search) return true
    const s = search.toLowerCase()
    const q = reqMap[r.requisition_id]
    return r.items?.name?.toLowerCase().includes(s)
      || r.items?.part_number?.toLowerCase().includes(s)
      || r.issued_by?.toLowerCase().includes(s)
      || r.req_number?.toLowerCase().includes(s)
      || q?.destination_location?.toLowerCase().includes(s)
      || q?.subject?.toLowerCase().includes(s)
  }), [records, search, reqMap])

  // split into requisition groups (one card per requisition) + loose/manual rows
  const { groups, manual } = useMemo(() => {
    const byId = {}
    const manualRows = []
    for (const r of filtered) {
      if (r.requisition_id && reqMap[r.requisition_id]) (byId[r.requisition_id] ||= []).push(r)
      else manualRows.push(r)
    }
    const groups = Object.entries(byId).map(([id, its]) => ({
      id, info: reqMap[id], items: its,
      totalQty: its.reduce((s, x) => s + Number(x.quantity_issued), 0),
      latest: its.reduce((m, x) => (x.date > m ? x.date : m), its[0].date),
    })).sort((a, b) => String(b.latest).localeCompare(String(a.latest)))
    return { groups, manual: manualRows }
  }, [filtered, reqMap])

  const filteredItems = items.filter(i =>
    i.name.toLowerCase().includes(itemSearch.toLowerCase()) ||
    i.part_number.toLowerCase().includes(itemSearch.toLowerCase())
  ).slice(0, 8)

  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))
  const toggle = (id) => setExpanded(p => ({ ...p, [id]: !p[id] }))

  const handleSave = async () => {
    if (!form.item_id)          { toast.error('Select an item'); return }
    if (!form.quantity_issued)  { toast.error('Enter quantity'); return }
    setSaving(true)
    const item = items.find(i => i.id === form.item_id)
    const { error } = await supabase.from('issuances').insert({
      item_id:         form.item_id,
      date:            form.date,
      quantity_issued: Number(form.quantity_issued),
      issued_by:       form.issued_by || 'Roni',
      note:            form.note,
    })
    if (error) { toast.error(error.message); setSaving(false); return }
    if (item) {
      const newStock = Math.max(0, Number(item.current_stock) - Number(form.quantity_issued))
      await supabase.from('items').update({ current_stock: newStock }).eq('id', form.item_id)
    }
    toast.success('Issuance recorded')
    setShowAdd(false); setForm(EMPTY); setItemSearch('')
    load(); setSaving(false)
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this issuance record?')) return
    await supabase.from('issuances').delete().eq('id', id)
    toast.success('Deleted'); load()
  }

  const selectedItem = items.find(i => i.id === form.item_id)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Daily Issuance</h1>
          <p className="page-sub">Scanned requisitions are grouped by destination — click to see the items</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={load} className="btn-ghost btn-sm"><RefreshCw className="w-4 h-4" /></button>
          <button onClick={() => setShowCSV(true)} className="btn-secondary btn-sm">
            <Upload className="w-4 h-4" /> Import CSV
          </button>
          <Button onClick={() => { setShowAdd(true); setForm(EMPTY); setItemSearch('') }}>
            <Plus className="w-4 h-4" /> Issue Item
          </Button>
        </div>
      </div>

      {/* Search + date range */}
      <div className="flex items-end gap-3 flex-wrap">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input placeholder="Search item, destination, subject, REQ #…" value={search} onChange={e => setSearch(e.target.value)}
            className="input pl-9 text-sm" />
          {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2"><X className="w-4 h-4 text-slate-400" /></button>}
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400">From</label>
          <input type="date" value={range.from} onChange={e => setRange(r => ({ ...r, from: e.target.value }))} className="input text-sm py-2 w-auto" />
          <label className="text-xs text-slate-400">To</label>
          <input type="date" value={range.to} onChange={e => setRange(r => ({ ...r, to: e.target.value }))} className="input text-sm py-2 w-auto" />
          {(range.from || range.to) && <button onClick={() => setRange({ from: '', to: '' })} className="btn-ghost btn-sm"><X className="w-4 h-4" /></button>}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-10 h-10 border-4 border-[#00AEEF] border-t-transparent rounded-full animate-spin" /></div>
      ) : (groups.length === 0 && manual.length === 0) ? (
        <div className="card text-center text-slate-500 py-12">No issuance records yet</div>
      ) : (
        <div className="space-y-3">
          {/* ── Requisition groups (one card per requisition) ─────────────── */}
          {groups.map(g => {
            const isOpen = !!expanded[g.id]
            const dest = g.info.destination_location || g.info.req_number || 'Requisition'
            return (
              <div key={g.id} className="card p-0 overflow-hidden">
                <button onClick={() => toggle(g.id)} className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-700/30 text-left">
                  <div className="flex items-center gap-3 min-w-0">
                    {isOpen ? <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />}
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-100 flex items-center gap-1.5 truncate">
                        <MapPin className="w-3.5 h-3.5 text-[#00AEEF] shrink-0" />{dest}
                      </p>
                      <p className="text-xs text-slate-400 truncate flex items-center gap-1.5 mt-0.5">
                        {g.info.subject && <span className="flex items-center gap-1"><FileText className="w-3 h-3" />{g.info.subject}</span>}
                        {g.info.subject && <span className="text-slate-600">·</span>}
                        <span className="font-mono">{g.info.req_number || '—'}</span>
                        <span className="text-slate-600">·</span>
                        <span>{g.latest}</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {g.info.purchase_type && <Badge variant="blue">{g.info.purchase_type}</Badge>}
                    <Badge variant="teal">{g.items.length} items</Badge>
                    <Badge variant="gray">{g.totalQty} units</Badge>
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t border-slate-700 overflow-x-auto">
                    {(g.info.requestor || g.info.source_location) && (
                      <div className="px-4 py-2 text-xs text-slate-400 flex flex-wrap gap-x-4 gap-y-1 bg-slate-800/40">
                        {g.info.requestor && <span>Requestor: <span className="text-slate-300">{g.info.requestor}</span></span>}
                        {g.info.source_location && <span>From: <span className="text-slate-300">{g.info.source_location}</span></span>}
                        {g.info.department && <span>Dept: <span className="text-slate-300">{g.info.department}</span></span>}
                      </div>
                    )}
                    <Table>
                      <Thead><tr>
                        <Th>Part #</Th><Th>Item</Th><Th>Qty Issued</Th><Th>Issued By</Th><Th>Date</Th><Th></Th>
                      </tr></Thead>
                      <Tbody>
                        {g.items.map(r => (
                          <Tr key={r.id}>
                            <Td className="font-mono text-xs text-slate-400">{r.items?.part_number}</Td>
                            <Td className="font-medium text-slate-100">{r.items?.name}</Td>
                            <Td><span className="font-bold text-[#00AEEF]">{r.quantity_issued}</span> <span className="text-slate-500 text-xs">{r.items?.unit}</span></Td>
                            <Td className="text-slate-300 text-sm">{r.issued_by}</Td>
                            <Td className="text-slate-400 text-xs whitespace-nowrap">{r.date}</Td>
                            <Td><button onClick={() => handleDelete(r.id)} className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button></Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </Table>
                  </div>
                )}
              </div>
            )
          })}

          {/* ── Manual / non-requisition issuances ───────────────────── */}
          {manual.length > 0 && (
            <div className="card overflow-x-auto">
              {groups.length > 0 && <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Manual issuances</p>}
              <Table>
                <Thead><tr>
                  <Th>Date</Th><Th>Part #</Th><Th>Item</Th><Th>Qty Issued</Th><Th>Issued By</Th><Th>Note</Th><Th></Th>
                </tr></Thead>
                <Tbody>
                  {manual.map(r => (
                    <Tr key={r.id}>
                      <Td className="text-slate-300 text-xs whitespace-nowrap">{r.date}</Td>
                      <Td className="font-mono text-xs text-slate-400">{r.items?.part_number}</Td>
                      <Td className="font-medium text-slate-100">{r.items?.name}</Td>
                      <Td><span className="font-bold text-[#00AEEF]">{r.quantity_issued}</span> <span className="text-slate-500 text-xs">{r.items?.unit}</span></Td>
                      <Td className="text-slate-300 text-sm">{r.issued_by}</Td>
                      <Td className="text-slate-400 text-xs max-w-xs truncate">{r.note}</Td>
                      <Td>
                        <button onClick={() => handleDelete(r.id)} className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </div>
          )}
        </div>
      )}

      {/* Add modal */}
      {showAdd && (
        <Modal isOpen onClose={() => setShowAdd(false)} title="Issue Item" size="sm"
          footer={<><Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button><Button onClick={handleSave} loading={saving}>Save Issuance</Button></>}>
          <div className="space-y-4">
            <Input label="Date *" type="date" value={form.date} onChange={f('date')} />
            {/* Item search */}
            <div className="relative">
              <label className="block text-sm font-medium text-slate-300 mb-1">Item *</label>
              {selectedItem ? (
                <div className="flex items-center gap-2 input bg-slate-700/50">
                  <span className="font-mono text-xs text-[#00AEEF]">{selectedItem.part_number}</span>
                  <span className="flex-1 text-slate-100">{selectedItem.name}</span>
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
                      <span className="text-slate-500 text-xs">{item.current_stock} {item.unit}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Input label="Quantity Issued *" type="number" min="0.01" step="0.01" value={form.quantity_issued} onChange={f('quantity_issued')}
              placeholder={selectedItem ? `Available: ${selectedItem.current_stock} ${selectedItem.unit}` : ''} />
            <Input label="Issued By" value={form.issued_by} onChange={f('issued_by')} />
            <Textarea label="Note" value={form.note} onChange={f('note')} rows={2} placeholder="e.g. Bar service, Kitchen prep…" />
          </div>
        </Modal>
      )}

      {showCSV && <CSVImportModal config={CSV_CONFIGS.issuances} onClose={() => setShowCSV(false)} onImported={load} />}
    </div>
  )
}
