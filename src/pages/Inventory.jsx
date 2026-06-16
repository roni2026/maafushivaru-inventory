import { useState, useMemo } from 'react'
import { Plus, Search, Pencil, Trash2, RefreshCw, ArrowUpDown, PackagePlus } from 'lucide-react'
import toast from 'react-hot-toast'
import { useItems } from '../hooks/useItems'
import { supabase } from '../lib/supabase'
import Modal from '../components/ui/Modal'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Table, { Thead, Tbody, Th, Td, Tr } from '../components/ui/Table'
import Input, { Select, Textarea } from '../components/ui/Input'

// ── helpers ───────────────────────────────────────────────

function daysUntil(d) {
  if (!d) return null
  const exp = new Date(d); exp.setHours(0,0,0,0)
  const now = new Date();  now.setHours(0,0,0,0)
  return Math.ceil((exp - now) / 86400000)
}
function rowClass(days) {
  if (days === null) return 'row-none'
  if (days <  0)    return 'row-expired'
  if (days <= 7)    return 'row-expired'
  if (days <= 15)   return 'row-critical'
  if (days <= 30)   return 'row-warning'
  return 'row-ok'
}
function expiryBadge(days) {
  if (days === null) return <Badge variant="gray">No expiry</Badge>
  if (days <  0)    return <Badge variant="red">Expired {Math.abs(days)}d ago</Badge>
  if (days <= 7)    return <Badge variant="red">{days}d left</Badge>
  if (days <= 15)   return <Badge variant="orange">{days}d left</Badge>
  if (days <= 30)   return <Badge variant="yellow">{days}d left</Badge>
  return                   <Badge variant="green">{days}d left</Badge>
}

const EMPTY_FORM = {
  part_number: '', name: '', store_id: '', unit: 'pcs',
  current_stock: '', min_stock: '', expiry_date: '',
  supplier: '', notes: '',
}
const UNITS = ['pcs','kg','g','L','mL','bottle','box','case','can','bag','jar','pack','roll']

// ── component ────────────────────────────────────────────

export default function Inventory() {
  const { items, stores, loading, addItem, updateItem, deleteItem, updateStock, refetch } = useItems()

  const [search,      setSearch]      = useState('')
  const [filterStore, setFilterStore] = useState('')
  const [filterCat,   setFilterCat]   = useState('')
  const [filterExp,   setFilterExp]   = useState('')  // 'expired','7','15','30','ok'
  const [sortField,   setSortField]   = useState('expiry_date')
  const [sortDir,     setSortDir]     = useState('asc')

  const [showAdd,    setShowAdd]    = useState(false)
  const [editItem,   setEditItem]   = useState(null)
  const [stockItem,  setStockItem]  = useState(null)
  const [deleteConf, setDeleteConf] = useState(null)
  const [form,       setForm]       = useState(EMPTY_FORM)
  const [saving,     setSaving]     = useState(false)

  // Stock-update state
  const [stockQty,    setStockQty]    = useState('')
  const [stockNote,   setStockNote]   = useState('')
  const [stockDate,   setStockDate]   = useState(new Date().toISOString().split('T')[0])
  const [stockUser,   setStockUser]   = useState('')
  const [stockMode,   setStockMode]   = useState('set') // 'set' | 'add' | 'subtract'

  // ── filtering + sorting ──────────────────────────────
  const categories = useMemo(() => [...new Set(stores.map(s => s.category))].sort(), [stores])

  const filtered = useMemo(() => {
    let list = [...items]
    if (search)      list = list.filter(i =>
      i.name.toLowerCase().includes(search.toLowerCase()) ||
      i.part_number.toLowerCase().includes(search.toLowerCase()))
    if (filterStore) list = list.filter(i => i.store_id === filterStore)
    if (filterCat)   list = list.filter(i => i.stores?.category === filterCat)
    if (filterExp) {
      list = list.filter(i => {
        const d = daysUntil(i.expiry_date)
        if (filterExp === 'expired') return d !== null && d < 0
        if (filterExp === '7')       return d !== null && d >= 0 && d <= 7
        if (filterExp === '15')      return d !== null && d >= 0 && d <= 15
        if (filterExp === '30')      return d !== null && d >= 0 && d <= 30
        if (filterExp === 'ok')      return d === null || d > 30
        return true
      })
    }
    list.sort((a, b) => {
      let va = a[sortField], vb = b[sortField]
      if (sortField === 'expiry_date') {
        if (!va) return 1; if (!vb) return -1
        va = new Date(va); vb = new Date(vb)
      } else if (typeof va === 'string') {
        va = va.toLowerCase(); vb = (vb || '').toLowerCase()
      }
      return sortDir === 'asc' ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1)
    })
    return list
  }, [items, search, filterStore, filterCat, filterExp, sortField, sortDir])

  const toggleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  // ── CRUD handlers ────────────────────────────────────
  const openAdd  = () => { setForm(EMPTY_FORM); setShowAdd(true) }
  const openEdit = (item) => {
    setEditItem(item)
    setForm({
      part_number:   item.part_number,
      name:          item.name,
      store_id:      item.store_id,
      unit:          item.unit,
      current_stock: item.current_stock,
      min_stock:     item.min_stock,
      expiry_date:   item.expiry_date || '',
      supplier:      item.supplier || '',
      notes:         item.notes || '',
    })
  }

  const handleSave = async () => {
    if (!form.part_number || !form.name || !form.store_id) {
      toast.error('Part Number, Name and Store are required')
      return
    }
    setSaving(true)
    try {
      if (editItem) {
        await updateItem(editItem.id, { ...form, current_stock: Number(form.current_stock), min_stock: Number(form.min_stock) })
        toast.success('Item updated')
        setEditItem(null)
      } else {
        await addItem({ ...form, current_stock: Number(form.current_stock), min_stock: Number(form.min_stock) })
        toast.success('Item added')
        setShowAdd(false)
      }
    } catch (err) {
      toast.error(err.message)
    }
    setSaving(false)
  }

  const handleDelete = async () => {
    try {
      await deleteItem(deleteConf.id)
      toast.success('Item deleted')
      setDeleteConf(null)
    } catch (err) {
      toast.error(err.message)
    }
  }

  const handleStock = async () => {
    const q = Number(stockQty)
    if (isNaN(q) || q <= 0) { toast.error('Enter a valid quantity'); return }
    const current = Number(stockItem.current_stock)
    const newQty  = stockMode === 'set' ? q : stockMode === 'add' ? current + q : Math.max(0, current - q)
    setSaving(true)
    try {
      await updateStock({
        itemId:         stockItem.id,
        quantityChange: newQty - current,
        newQuantity:    newQty,
        updatedBy:      stockUser || 'Manual',
        note:           stockNote,
        date:           stockDate,
      })
      toast.success(`Stock updated to ${newQty}`)
      setStockItem(null); setStockQty(''); setStockNote(''); setStockUser('')
    } catch (err) {
      toast.error(err.message)
    }
    setSaving(false)
  }

  const f = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }))

  // ── render ───────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h1 className="page-title">Inventory</h1><p className="page-sub">{filtered.length} items</p></div>
        <div className="flex gap-2">
          <button onClick={refetch} className="btn-ghost btn-sm"><RefreshCw className="w-4 h-4" /></button>
          <Button onClick={openAdd}><Plus className="w-4 h-4" /> Add Item</Button>
        </div>
      </div>

      {/* Filters */}
      <div className="card py-4 px-5 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input placeholder="Search name or part #…" value={search} onChange={e => setSearch(e.target.value)}
            className="input pl-9 text-sm" />
        </div>
        <select value={filterStore} onChange={e => setFilterStore(e.target.value)} className="input text-sm w-auto">
          <option value="">All Stores</option>
          {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={filterCat} onChange={e => setFilterCat(e.target.value)} className="input text-sm w-auto">
          <option value="">All Categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={filterExp} onChange={e => setFilterExp(e.target.value)} className="input text-sm w-auto">
          <option value="">All Expiry</option>
          <option value="expired">Expired</option>
          <option value="7">≤ 7 days</option>
          <option value="15">≤ 15 days</option>
          <option value="30">≤ 30 days</option>
          <option value="ok">Good (&gt;30d)</option>
        </select>
      </div>

      {/* Legend */}
      <div className="flex gap-3 flex-wrap text-xs text-slate-400">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-500" /> Expired / ≤7d</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-orange-500" /> 8–15d</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-500" /> 16–30d</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-600" /> &gt;30d</span>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-20"><div className="w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-16 text-slate-500">
          <Package className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="font-medium">No items found</p>
          <p className="text-sm mt-1">Adjust your filters or add a new item.</p>
        </div>
      ) : (
        <Table>
          <Thead>
            <tr>
              <Th sortable onClick={() => toggleSort('part_number')} sorted={sortField==='part_number' ? sortDir : undefined}>Part #</Th>
              <Th sortable onClick={() => toggleSort('name')} sorted={sortField==='name' ? sortDir : undefined}>Item Name</Th>
              <Th>Store</Th>
              <Th>Unit</Th>
              <Th sortable onClick={() => toggleSort('current_stock')} sorted={sortField==='current_stock' ? sortDir : undefined}>Stock</Th>
              <Th>Min Stock</Th>
              <Th sortable onClick={() => toggleSort('expiry_date')} sorted={sortField==='expiry_date' ? sortDir : undefined}>Expiry</Th>
              <Th>Supplier</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </Thead>
          <Tbody>
            {filtered.map(item => {
              const days = daysUntil(item.expiry_date)
              const lowStock = Number(item.current_stock) <= Number(item.min_stock)
              return (
                <Tr key={item.id} className={rowClass(days)}>
                  <Td className="font-mono text-xs text-slate-300">{item.part_number}</Td>
                  <Td className="font-medium text-slate-100 max-w-xs truncate">{item.name}</Td>
                  <Td><span className="text-xs text-slate-400">{item.stores?.name}</span></Td>
                  <Td className="text-slate-400 text-xs">{item.unit}</Td>
                  <Td>
                    <span className={`font-semibold ${lowStock ? 'text-red-400' : 'text-slate-100'}`}>
                      {item.current_stock}
                    </span>
                    {lowStock && <span className="ml-1 text-red-400 text-xs">⚠</span>}
                  </Td>
                  <Td className="text-slate-400">{item.min_stock}</Td>
                  <Td>{expiryBadge(days)}</Td>
                  <Td className="text-slate-400 text-xs max-w-xs truncate">{item.supplier || '—'}</Td>
                  <Td>
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => { setStockItem(item); setStockQty(''); setStockNote(''); setStockMode('set'); setStockDate(new Date().toISOString().split('T')[0]) }}
                        className="p-1.5 hover:bg-teal-700/30 rounded-lg transition-colors text-teal-400" title="Update Stock">
                        <PackagePlus className="w-4 h-4" />
                      </button>
                      <button onClick={() => openEdit(item)}
                        className="p-1.5 hover:bg-slate-700 rounded-lg transition-colors text-slate-400 hover:text-slate-100" title="Edit">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => setDeleteConf(item)}
                        className="p-1.5 hover:bg-red-900/30 rounded-lg transition-colors text-slate-400 hover:text-red-400" title="Delete">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </Td>
                </Tr>
              )
            })}
          </Tbody>
        </Table>
      )}

      {/* ── Add / Edit Modal ────────────────────────────── */}
      <Modal isOpen={showAdd || !!editItem} onClose={() => { setShowAdd(false); setEditItem(null) }}
        title={editItem ? 'Edit Item' : 'Add New Item'}
        footer={<>
          <Button variant="secondary" onClick={() => { setShowAdd(false); setEditItem(null) }}>Cancel</Button>
          <Button onClick={handleSave} loading={saving}>Save</Button>
        </>}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Part Number *" value={form.part_number} onChange={f('part_number')} placeholder="e.g. BEV-001" required />
          <Input label="Item Name *" value={form.name} onChange={f('name')} placeholder="e.g. Mineral Water 500mL" required />
          <Select label="Store *" value={form.store_id} onChange={f('store_id')}>
            <option value="">Select store…</option>
            {stores.map(s => <option key={s.id} value={s.id}>{s.name} ({s.category})</option>)}
          </Select>
          <Select label="Unit" value={form.unit} onChange={f('unit')}>
            {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
          </Select>
          <Input label="Current Stock" type="number" min="0" step="0.01" value={form.current_stock} onChange={f('current_stock')} placeholder="0" />
          <Input label="Minimum Stock Level" type="number" min="0" step="0.01" value={form.min_stock} onChange={f('min_stock')} placeholder="0" />
          <Input label="Expiry Date" type="date" value={form.expiry_date} onChange={f('expiry_date')} />
          <Input label="Supplier" value={form.supplier} onChange={f('supplier')} placeholder="Supplier name" />
          <div className="sm:col-span-2">
            <Textarea label="Notes" value={form.notes} onChange={f('notes')} placeholder="Any notes…" rows={2} />
          </div>
        </div>
      </Modal>

      {/* ── Stock Update Modal ───────────────────────────── */}
      <Modal isOpen={!!stockItem} onClose={() => setStockItem(null)} title="Update Stock" size="sm"
        footer={<>
          <Button variant="secondary" onClick={() => setStockItem(null)}>Cancel</Button>
          <Button onClick={handleStock} loading={saving}>Update</Button>
        </>}
      >
        {stockItem && (
          <div className="space-y-4">
            <div className="bg-slate-700/40 rounded-lg p-3">
              <p className="font-medium text-slate-100">{stockItem.name}</p>
              <p className="text-xs text-slate-400 mt-0.5">{stockItem.part_number} · Current: <strong className="text-teal-400">{stockItem.current_stock} {stockItem.unit}</strong></p>
            </div>
            <Select label="Update Mode" value={stockMode} onChange={e => setStockMode(e.target.value)}>
              <option value="set">Set exact quantity</option>
              <option value="add">Add to current stock</option>
              <option value="subtract">Subtract from current stock</option>
            </Select>
            <Input label={`Quantity (${stockItem.unit})`} type="number" min="0" step="0.01" value={stockQty} onChange={e => setStockQty(e.target.value)} placeholder="0" />
            <Input label="Date" type="date" value={stockDate} onChange={e => setStockDate(e.target.value)} />
            <Input label="Updated By" value={stockUser} onChange={e => setStockUser(e.target.value)} placeholder="Your name" />
            <Input label="Note (optional)" value={stockNote} onChange={e => setStockNote(e.target.value)} placeholder="e.g. Received from supplier" />
            {stockQty && (
              <div className="bg-teal-900/30 border border-teal-700/40 rounded-lg p-3 text-sm">
                New stock will be: <strong className="text-teal-300">
                  {stockMode === 'set' ? Number(stockQty)
                    : stockMode === 'add' ? Number(stockItem.current_stock) + Number(stockQty)
                    : Math.max(0, Number(stockItem.current_stock) - Number(stockQty))} {stockItem.unit}
                </strong>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ── Delete Confirm ───────────────────────────────── */}
      <Modal isOpen={!!deleteConf} onClose={() => setDeleteConf(null)} title="Delete Item" size="sm"
        footer={<>
          <Button variant="secondary" onClick={() => setDeleteConf(null)}>Cancel</Button>
          <Button variant="danger" onClick={handleDelete}>Delete</Button>
        </>}
      >
        {deleteConf && (
          <p className="text-slate-300">
            Are you sure you want to delete <strong className="text-slate-100">{deleteConf.name}</strong>?
            This will also remove all associated stock updates and issuances. This cannot be undone.
          </p>
        )}
      </Modal>
    </div>
  )
}
