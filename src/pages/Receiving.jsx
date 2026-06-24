import { useState, useEffect, useMemo } from 'react'
import { useSort } from '../hooks/useSort'
import { supabase, selectAll } from '../lib/supabase'
import { Plus, Search, Trash2, Upload, X, RefreshCw, CheckCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Table, { Thead, Tbody, Th, Td, Tr } from '../components/ui/Table'
import Modal from '../components/ui/Modal'
import Input, { Textarea } from '../components/ui/Input'
import CSVImportModal from '../components/CSVImportModal'
import { CSV_CONFIGS } from '../lib/csvTemplates'

const today = () => new Date().toISOString().split('T')[0]
const EMPTY = { date: today(), item_id: '', quantity_received: '', unit: '', supplier_name: '', received_by: 'Roni', invoice_number: '', unit_cost: '', note: '' }

export default function Receiving() {
  const [records, setRecords] = useState([])
  const [items,   setItems]   = useState([])
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [showCSV, setShowCSV] = useState(false)
  const [form,    setForm]    = useState(EMPTY)
  const [saving,  setSaving]  = useState(false)
  const [itemSearch, setItemSearch] = useState('')
  const [showItemDrop, setShowItemDrop] = useState(false)

  const load = async () => {
    setLoading(true)
    const [{ data: r }, { data: i }] = await Promise.all([
      supabase.from('receiving').select('*').order('date', { ascending: false }).limit(200),
      selectAll(() => supabase.from('items').select('id,name,part_number,unit,current_stock').eq('active', true).order('name')),
    ])
    setRecords(r || []); setItems(i || []); setLoading(false)
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => records.filter(r =>
    !search ||
    r.item_name?.toLowerCase().includes(search.toLowerCase()) ||
    r.supplier_name?.toLowerCase().includes(search.toLowerCase()) ||
    r.invoice_number?.toLowerCase().includes(search.toLowerCase())
  ), [records, search])

  const { sorted, thProps } = useSort(filtered, 'date', 'desc')

  const filteredItems = items.filter(i =>
    i.name.toLowerCase().includes(itemSearch.toLowerCase()) ||
    i.part_number.toLowerCase().includes(itemSearch.toLowerCase())
  ).slice(0, 8)

  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  const handleSave = async () => {
    if (!form.item_id)            { toast.error('Select an item'); return }
    if (!form.quantity_received)  { toast.error('Enter quantity'); return }
    setSaving(true)
    const item = items.find(i => i.id === form.item_id)
    const { error } = await supabase.from('receiving').insert({
      item_id:           form.item_id,
      item_name:         item?.name || '',
      date:              form.date,
      quantity_received: Number(form.quantity_received),
      unit:              form.unit || item?.unit || 'pcs',
      supplier_name:     form.supplier_name,
      received_by:       form.received_by || 'Roni',
      invoice_number:    form.invoice_number,
      unit_cost:         Number(form.unit_cost) || 0,
      note:              form.note,
    })
    if (error) { toast.error(error.message); setSaving(false); return }
    // Update stock
    if (item) {
      const newStock = Number(item.current_stock) + Number(form.quantity_received)
      await supabase.from('items').update({ current_stock: newStock }).eq('id', form.item_id)
      await supabase.from('stock_updates').insert({
        item_id: form.item_id, date: form.date, quantity_change: Number(form.quantity_received),
        new_quantity: newStock, updated_by: form.received_by || 'Roni', note: `Received from ${form.supplier_name || 'supplier'}`
      }).catch(() => {})
    }
    toast.success('Receiving recorded — stock updated'); setShowAdd(false); setForm(EMPTY); setItemSearch(''); load(); setSaving(false)
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this receiving record? Stock will NOT be reversed.')) return
    await supabase.from('receiving').delete().eq('id', id)
    toast.success('Deleted'); load()
  }

  const selectedItem = items.find(i => i.id === form.item_id)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Receiving (GRN)</h1>
          <p className="page-sub">Log items received from suppliers — stock is updated automatically</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={load} className="btn-ghost btn-sm"><RefreshCw className="w-4 h-4" /></button>
          <button onClick={() => setShowCSV(true)} className="btn-secondary btn-sm"><Upload className="w-4 h-4" /> Import CSV</button>
          <Button onClick={() => { setShowAdd(true); setForm(EMPTY); setItemSearch('') }}><Plus className="w-4 h-4" /> Add GRN</Button>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input placeholder="Search item, supplier or invoice…" value={search} onChange={e => setSearch(e.target.value)} className="input pl-9 text-sm" />
        {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2"><X className="w-4 h-4 text-slate-400" /></button>}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-10 h-10 border-4 border-[#00AEEF] border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="card overflow-x-auto">
          <Table>
            <Thead><tr>
              <Th {...thProps('date')}>Date</Th><Th {...thProps('item_name')}>Item</Th><Th {...thProps('quantity_received')}>Qty Received</Th><Th {...thProps('supplier_name')}>Supplier</Th><Th {...thProps('invoice_number')}>Invoice #</Th><Th {...thProps('unit_cost')}>Unit Cost</Th><Th {...thProps('received_by')}>Received By</Th><Th></Th>
            </tr></Thead>
            <Tbody>
              {sorted.length === 0 ? (
                <Tr><Td colSpan={8} className="text-center text-slate-500 py-12">No receiving records yet</Td></Tr>
              ) : sorted.map(r => (
                <Tr key={r.id}>
                  <Td className="text-slate-300 text-xs whitespace-nowrap">{r.date}</Td>
                  <Td className="font-medium text-slate-100">{r.item_name}</Td>
                  <Td><span className="font-bold text-green-400">{r.quantity_received}</span> <span className="text-slate-500 text-xs">{r.unit}</span></Td>
                  <Td className="text-slate-300 text-sm">{r.supplier_name}</Td>
                  <Td className="font-mono text-xs text-slate-400">{r.invoice_number || '—'}</Td>
                  <Td className="text-slate-300 text-sm">{r.unit_cost ? `$${Number(r.unit_cost).toFixed(2)}` : '—'}</Td>
                  <Td className="text-slate-300 text-sm">{r.received_by}</Td>
                  <Td>
                    <button onClick={() => handleDelete(r.id)} className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      )}

      {showAdd && (
        <Modal isOpen onClose={() => setShowAdd(false)} title="Add Receiving (GRN)" size="sm"
          footer={<><Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button><Button onClick={handleSave} loading={saving}><CheckCircle2 className="w-4 h-4" /> Save & Update Stock</Button></>}>
          <div className="space-y-4">
            <Input label="Date *" type="date" value={form.date} onChange={f('date')} />
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
                    <button key={item.id} onClick={() => { setForm(p => ({...p, item_id: item.id, unit: item.unit})); setItemSearch(''); setShowItemDrop(false) }}
                      className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-slate-700 text-left text-sm">
                      <span className="font-mono text-xs text-[#00AEEF] w-20 shrink-0">{item.part_number}</span>
                      <span className="flex-1 text-slate-200 truncate">{item.name}</span>
                      <span className="text-slate-500 text-xs">{item.unit}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Qty Received *" type="number" min="0.01" step="0.01" value={form.quantity_received} onChange={f('quantity_received')} />
              <Input label="Unit Cost ($)" type="number" min="0" step="0.01" value={form.unit_cost} onChange={f('unit_cost')} placeholder="0.00" />
            </div>
            <Input label="Supplier Name" value={form.supplier_name} onChange={f('supplier_name')} placeholder="e.g. Maldives Fresh Co" />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Invoice #" value={form.invoice_number} onChange={f('invoice_number')} placeholder="INV-2026-001" />
              <Input label="Received By" value={form.received_by} onChange={f('received_by')} />
            </div>
            <Textarea label="Note" value={form.note} onChange={f('note')} rows={2} />
          </div>
        </Modal>
      )}

      {showCSV && <CSVImportModal config={CSV_CONFIGS.receiving} onClose={() => setShowCSV(false)} onImported={load} />}
    </div>
  )
}
