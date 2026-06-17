import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { Plus, Search, Upload, X, RefreshCw, ArrowRight } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Table, { Thead, Tbody, Th, Td, Tr } from '../components/ui/Table'
import Modal from '../components/ui/Modal'
import Input, { Select, Textarea } from '../components/ui/Input'
import CSVImportModal from '../components/CSVImportModal'
import { CSV_CONFIGS } from '../lib/csvTemplates'

const today = () => new Date().toISOString().split('T')[0]
const EMPTY = { date: today(), item_id: '', quantity: '', from_store_id: '', to_store_id: '', transferred_by: 'Roni', note: '' }

export default function Transfers() {
  const [records, setRecords] = useState([])
  const [items,   setItems]   = useState([])
  const [stores,  setStores]  = useState([])
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [showCSV, setShowCSV] = useState(false)
  const [form,    setForm]    = useState(EMPTY)
  const [saving,  setSaving]  = useState(false)
  const [itemSearch, setItemSearch]   = useState('')
  const [showItemDrop, setShowItemDrop] = useState(false)

  const load = async () => {
    setLoading(true)
    const [{ data: r }, { data: i }, { data: s }] = await Promise.all([
      supabase.from('transfers').select('*').order('date', { ascending: false }).limit(200),
      supabase.from('items').select('id,name,part_number,unit,current_stock').order('name'),
      supabase.from('stores').select('*').order('name'),
    ])
    setRecords(r || []); setItems(i || []); setStores(s || []); setLoading(false)
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => records.filter(r =>
    !search ||
    r.item_name?.toLowerCase().includes(search.toLowerCase()) ||
    r.from_store_name?.toLowerCase().includes(search.toLowerCase()) ||
    r.to_store_name?.toLowerCase().includes(search.toLowerCase())
  ), [records, search])

  const filteredItems = items.filter(i =>
    i.name.toLowerCase().includes(itemSearch.toLowerCase()) ||
    i.part_number.toLowerCase().includes(itemSearch.toLowerCase())
  ).slice(0, 8)

  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))
  const selectedItem    = items.find(i => i.id === form.item_id)
  const selectedFrom    = stores.find(s => s.id === form.from_store_id)
  const selectedTo      = stores.find(s => s.id === form.to_store_id)

  const handleSave = async () => {
    if (!form.item_id)       { toast.error('Select an item'); return }
    if (!form.quantity)      { toast.error('Enter quantity'); return }
    if (!form.from_store_id) { toast.error('Select from store'); return }
    if (!form.to_store_id)   { toast.error('Select to store'); return }
    if (form.from_store_id === form.to_store_id) { toast.error('From and To stores cannot be the same'); return }
    setSaving(true)
    const item = items.find(i => i.id === form.item_id)
    const { error } = await supabase.from('transfers').insert({
      item_id:        form.item_id,
      item_name:      item?.name || '',
      date:           form.date,
      quantity:       Number(form.quantity),
      unit:           item?.unit || 'pcs',
      from_store_id:  form.from_store_id,
      from_store_name:selectedFrom?.name || '',
      to_store_id:    form.to_store_id,
      to_store_name:  selectedTo?.name || '',
      transferred_by: form.transferred_by || 'Roni',
      note:           form.note,
      status:         'completed',
    })
    if (error) { toast.error(error.message); setSaving(false); return }
    toast.success('Transfer recorded'); setShowAdd(false); setForm(EMPTY); setItemSearch(''); load(); setSaving(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Transfers</h1>
          <p className="page-sub">Move items between stores and outlets</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={load} className="btn-ghost btn-sm"><RefreshCw className="w-4 h-4" /></button>
          <button onClick={() => setShowCSV(true)} className="btn-secondary btn-sm"><Upload className="w-4 h-4" /> Import CSV</button>
          <Button onClick={() => { setShowAdd(true); setForm(EMPTY); setItemSearch('') }}><Plus className="w-4 h-4" /> New Transfer</Button>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input placeholder="Search item or store…" value={search} onChange={e => setSearch(e.target.value)} className="input pl-9 text-sm" />
        {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2"><X className="w-4 h-4 text-slate-400" /></button>}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-10 h-10 border-4 border-[#00AEEF] border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="card overflow-x-auto">
          <Table>
            <Thead><tr>
              <Th>Date</Th><Th>Item</Th><Th>Quantity</Th><Th>From</Th><Th></Th><Th>To</Th><Th>By</Th><Th>Note</Th>
            </tr></Thead>
            <Tbody>
              {filtered.length === 0 ? (
                <Tr><Td colSpan={8} className="text-center text-slate-500 py-12">No transfer records yet</Td></Tr>
              ) : filtered.map(r => (
                <Tr key={r.id}>
                  <Td className="text-slate-300 text-xs whitespace-nowrap">{r.date}</Td>
                  <Td className="font-medium text-slate-100">{r.item_name}</Td>
                  <Td><span className="font-bold text-[#00AEEF]">{r.quantity}</span> <span className="text-slate-500 text-xs">{r.unit}</span></Td>
                  <Td className="text-slate-300 text-sm">{r.from_store_name}</Td>
                  <Td><ArrowRight className="w-4 h-4 text-slate-500" /></Td>
                  <Td className="text-slate-300 text-sm">{r.to_store_name}</Td>
                  <Td className="text-slate-400 text-sm">{r.transferred_by}</Td>
                  <Td className="text-slate-400 text-xs max-w-xs truncate">{r.note}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      )}

      {showAdd && (
        <Modal isOpen onClose={() => setShowAdd(false)} title="New Transfer" size="sm"
          footer={<><Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button><Button onClick={handleSave} loading={saving}>Save Transfer</Button></>}>
          <div className="space-y-4">
            <Input label="Date *" type="date" value={form.date} onChange={f('date')} />
            <div className="relative">
              <label className="block text-sm font-medium text-slate-300 mb-1">Item *</label>
              {selectedItem ? (
                <div className="input bg-slate-700/50 flex items-center gap-2">
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
                      <span className="text-slate-400 text-xs">{item.current_stock} {item.unit}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Input label="Quantity *" type="number" min="0.01" step="0.01" value={form.quantity} onChange={f('quantity')} />
            <div className="grid grid-cols-2 gap-3">
              <Select label="From Store *" value={form.from_store_id} onChange={f('from_store_id')}>
                <option value="">Select…</option>
                {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
              <Select label="To Store *" value={form.to_store_id} onChange={f('to_store_id')}>
                <option value="">Select…</option>
                {stores.filter(s => s.id !== form.from_store_id).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </div>
            <Input label="Transferred By" value={form.transferred_by} onChange={f('transferred_by')} />
            <Textarea label="Note" value={form.note} onChange={f('note')} rows={2} />
          </div>
        </Modal>
      )}

      {showCSV && <CSVImportModal config={CSV_CONFIGS.transfers} onClose={() => setShowCSV(false)} onImported={load} />}
    </div>
  )
}
