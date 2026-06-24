import { useState, useEffect, useMemo } from 'react'
import { supabase, selectAll } from '../lib/supabase'
import { Plus, Search, Trash2, Upload, X, RefreshCw } from 'lucide-react'
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
  const [items,   setItems]   = useState([])
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')
  const [range,   setRange]   = useState({ from: '', to: '' })
  const [showAdd, setShowAdd] = useState(false)
  const [showCSV, setShowCSV] = useState(false)
  const [form,    setForm]    = useState(EMPTY)
  const [saving,  setSaving]  = useState(false)
  const [itemSearch, setItemSearch] = useState('')
  const [showItemDrop, setShowItemDrop] = useState(false)

  const load = async () => {
    setLoading(true)
    let iq = supabase.from('issuances').select('*,items(name,part_number,unit)').order('date', { ascending: false }).limit(500)
    if (range.from) iq = iq.gte('date', range.from)
    if (range.to)   iq = iq.lte('date', range.to)
    const [{ data: r }, { data: i }] = await Promise.all([
      iq,
      selectAll(() => supabase.from('items').select('id,name,part_number,unit,current_stock').eq('active', true).order('name')),
    ])
    setRecords(r || [])
    setItems(i || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [range.from, range.to])

  const filtered = useMemo(() =>
    records.filter(r =>
      !search ||
      r.items?.name?.toLowerCase().includes(search.toLowerCase()) ||
      r.items?.part_number?.toLowerCase().includes(search.toLowerCase()) ||
      r.issued_by?.toLowerCase().includes(search.toLowerCase())
    ), [records, search])

  const filteredItems = items.filter(i =>
    i.name.toLowerCase().includes(itemSearch.toLowerCase()) ||
    i.part_number.toLowerCase().includes(itemSearch.toLowerCase())
  ).slice(0, 8)

  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

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
    // Deduct stock
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
          <p className="page-sub">Record items issued to departments or outlets</p>
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
          <input placeholder="Search item, part # or issued by…" value={search} onChange={e => setSearch(e.target.value)}
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
      ) : (
        <div className="card overflow-x-auto">
          <Table>
            <Thead><tr>
              <Th>Date</Th><Th>Part #</Th><Th>Item</Th><Th>Req #</Th><Th>Qty Issued</Th><Th>Issued By</Th><Th>Note</Th><Th></Th>
            </tr></Thead>
            <Tbody>
              {filtered.length === 0 ? (
                <Tr><Td colSpan={8} className="text-center text-slate-500 py-12">No issuance records yet</Td></Tr>
              ) : filtered.map(r => (
                <Tr key={r.id}>
                  <Td className="text-slate-300 text-xs whitespace-nowrap">{r.date}</Td>
                  <Td className="font-mono text-xs text-slate-400">{r.items?.part_number}</Td>
                  <Td className="font-medium text-slate-100">{r.items?.name}</Td>
                  <Td className="font-mono text-[10px] text-slate-500">{r.req_number || '—'}</Td>
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
