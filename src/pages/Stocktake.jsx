import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { Plus, Search, Upload, X, RefreshCw, CheckCircle2, ClipboardCheck } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Table, { Thead, Tbody, Th, Td, Tr } from '../components/ui/Table'
import Modal from '../components/ui/Modal'
import Input, { Textarea } from '../components/ui/Input'
import CSVImportModal from '../components/CSVImportModal'
import { CSV_CONFIGS } from '../lib/csvTemplates'

const today = () => new Date().toISOString().split('T')[0]
const EMPTY = { date: today(), item_id: '', counted_quantity: '', note: '' }

export default function Stocktake() {
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
      supabase.from('stocktake_entries').select('*,items(name,part_number,unit)').order('date', { ascending: false }).limit(200),
      supabase.from('items').select('id,name,part_number,unit,current_stock').order('name'),
    ])
    setRecords(r || []); setItems(i || []); setLoading(false)
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => records.filter(r =>
    !search ||
    r.item_name?.toLowerCase().includes(search.toLowerCase()) ||
    r.items?.name?.toLowerCase().includes(search.toLowerCase())
  ), [records, search])

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
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Stocktake</h1>
          <p className="page-sub">Physical count — compare vs system stock and approve adjustments</p>
        </div>
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
              <Th>Date</Th><Th>Part #</Th><Th>Item</Th><Th>System Qty</Th><Th>Counted</Th><Th>Difference</Th><Th>Status</Th><Th>Action</Th>
            </tr></Thead>
            <Tbody>
              {filtered.length === 0 ? (
                <Tr><Td colSpan={8} className="text-center text-slate-500 py-12">No stocktake entries yet</Td></Tr>
              ) : filtered.map(r => {
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
