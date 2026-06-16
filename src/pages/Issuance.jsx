import { useState, useMemo, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { ClipboardList, Search, Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Modal from '../components/ui/Modal'
import Table, { Thead, Tbody, Th, Td, Tr } from '../components/ui/Table'
import Input, { Select } from '../components/ui/Input'

const today = () => new Date().toISOString().split('T')[0]
const yesterday = () => {
  const d = new Date(); d.setDate(d.getDate()-1); return d.toISOString().split('T')[0]
}

export default function Issuance() {
  const [items,     setItems]     = useState([])
  const [stores,    setStores]    = useState([])
  const [issuances, setIssuances] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [search,    setSearch]    = useState('')

  // Form
  const [query,    setQuery]    = useState('')
  const [itemSel,  setItemSel]  = useState(null)
  const [qty,      setQty]      = useState('')
  const [date,     setDate]     = useState(today())
  const [loggedBy, setLoggedBy] = useState('')
  const [showSug,  setShowSug]  = useState(false)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const [{ data: it }, { data: st }, { data: iss }] = await Promise.all([
        supabase.from('items').select('id, part_number, name, unit, current_stock, store_id, stores(name)').order('name'),
        supabase.from('stores').select('*').order('name'),
        supabase.from('issuances')
          .select('*, items(id, part_number, name, unit), stores(name)')
          .order('date', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(100),
      ])
      setItems(it || [])
      setStores(st || [])
      setIssuances(iss || [])
      setLoading(false)
    }
    load()
  }, [])

  // Autocomplete
  const suggestions = useMemo(() => {
    if (!query || query.length < 2) return []
    const q = query.toLowerCase()
    return items.filter(i =>
      i.name.toLowerCase().includes(q) || i.part_number.toLowerCase().includes(q)
    ).slice(0, 8)
  }, [query, items])

  const selectItem = (item) => {
    setItemSel(item)
    setQuery(`${item.part_number} – ${item.name}`)
    setShowSug(false)
  }

  const handleLog = async () => {
    if (!itemSel) { toast.error('Select an item'); return }
    const q = Number(qty)
    if (!q || q <= 0) { toast.error('Enter a valid quantity'); return }
    if (q > Number(itemSel.current_stock)) {
      toast.error(`Only ${itemSel.current_stock} ${itemSel.unit} in stock`)
      return
    }
    setSaving(true)
    try {
      const newStock = Number(itemSel.current_stock) - q
      await supabase.from('items').update({ current_stock: newStock }).eq('id', itemSel.id)
      await supabase.from('stock_updates').insert({
        item_id: itemSel.id, date, quantity_change: -q, new_quantity: newStock,
        updated_by: loggedBy || 'System', note: 'Daily issuance',
      })
      const { data: iss } = await supabase.from('issuances')
        .insert({ item_id: itemSel.id, store_id: itemSel.store_id, quantity_issued: q, date, logged_by: loggedBy || 'System' })
        .select('*, items(id, part_number, name, unit), stores(name)')
        .single()
      setIssuances(prev => [iss, ...prev])
      setItems(prev => prev.map(i => i.id === itemSel.id ? { ...i, current_stock: newStock } : i))
      toast.success(`Issued ${q} ${itemSel.unit} of ${itemSel.name}`)
      setItemSel(null); setQuery(''); setQty(''); setShowModal(false)
    } catch (err) { toast.error(err.message) }
    setSaving(false)
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this issuance record? Stock will NOT be restored automatically.')) return
    await supabase.from('issuances').delete().eq('id', id)
    setIssuances(prev => prev.filter(i => i.id !== id))
    toast.success('Record deleted')
  }

  const filtered = useMemo(() => {
    if (!search) return issuances
    const q = search.toLowerCase()
    return issuances.filter(i =>
      i.items?.name?.toLowerCase().includes(q) ||
      i.items?.part_number?.toLowerCase().includes(q)
    )
  }, [issuances, search])

  // Weekly totals per item (last 7 days)
  const weeklyMap = useMemo(() => {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate()-7)
    const map = {}
    issuances.forEach(i => {
      if (new Date(i.date) >= cutoff) {
        map[i.item_id] = (map[i.item_id] || 0) + Number(i.quantity_issued)
      }
    })
    return map
  }, [issuances])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h1 className="page-title">Daily Issuance</h1><p className="page-sub">Log items issued each day</p></div>
        <Button onClick={() => { setDate(today()); setShowModal(true) }}>
          <Plus className="w-4 h-4" /> Log Issuance
        </Button>
      </div>

      {/* Search */}
      <div className="card py-3 px-4 flex gap-3 items-center">
        <Search className="w-4 h-4 text-slate-400 shrink-0" />
        <input className="input flex-1" placeholder="Search issuances…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Issuances table */}
      {loading ? (
        <div className="flex justify-center py-16"><div className="w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-16 text-slate-500">
          <ClipboardList className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="font-medium">No issuances yet</p>
          <p className="text-sm mt-1">Start logging daily issuances.</p>
        </div>
      ) : (
        <Table>
          <Thead><tr>
            <Th>Date</Th>
            <Th>Part #</Th>
            <Th>Item Name</Th>
            <Th>Store</Th>
            <Th>Qty Issued</Th>
            <Th>Weekly Total</Th>
            <Th>Logged By</Th>
            <Th className="text-right">Actions</Th>
          </tr></Thead>
          <Tbody>
            {filtered.map(iss => (
              <Tr key={iss.id}>
                <Td className="text-slate-400 text-xs">{iss.date}</Td>
                <Td className="font-mono text-xs text-slate-300">{iss.items?.part_number}</Td>
                <Td className="font-medium text-slate-100">{iss.items?.name}</Td>
                <Td className="text-slate-400 text-xs">{iss.stores?.name}</Td>
                <Td><Badge variant="teal">{iss.quantity_issued} {iss.items?.unit}</Badge></Td>
                <Td><span className="text-slate-300 text-sm">{weeklyMap[iss.item_id] || 0} {iss.items?.unit}</span></Td>
                <Td className="text-slate-400 text-xs">{iss.logged_by || '—'}</Td>
                <Td>
                  <div className="flex justify-end">
                    <button onClick={() => handleDelete(iss.id)} className="p-1.5 hover:bg-red-900/30 rounded-lg transition-colors text-slate-400 hover:text-red-400">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}

      {/* Log Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Log Issuance" size="sm"
        footer={<>
          <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
          <Button onClick={handleLog} loading={saving}>Log Issuance</Button>
        </>}
      >
        <div className="space-y-4">
          {/* Item autocomplete */}
          <div className="relative">
            <label className="block text-sm font-medium text-slate-300 mb-1">Item (Part # or Name) *</label>
            <input
              className="input"
              placeholder="Type to search…"
              value={query}
              onChange={e => { setQuery(e.target.value); setItemSel(null); setShowSug(true) }}
              onFocus={() => setShowSug(true)}
            />
            {showSug && suggestions.length > 0 && (
              <div className="absolute z-20 mt-1 w-full bg-slate-700 border border-slate-600 rounded-lg shadow-xl overflow-hidden">
                {suggestions.map(i => (
                  <button key={i.id} onMouseDown={() => selectItem(i)}
                    className="w-full text-left px-4 py-2.5 hover:bg-slate-600 transition-colors text-sm">
                    <span className="font-mono text-teal-400 text-xs">{i.part_number}</span>
                    <span className="ml-2 text-slate-100">{i.name}</span>
                    <span className="ml-2 text-slate-400 text-xs">({i.current_stock} {i.unit})</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {itemSel && (
            <div className="bg-slate-700/40 rounded-lg p-3 text-sm">
              <p className="font-medium text-slate-100">{itemSel.name}</p>
              <p className="text-slate-400 text-xs mt-0.5">
                Store: {itemSel.stores?.name} · In stock: <strong className="text-teal-400">{itemSel.current_stock} {itemSel.unit}</strong>
              </p>
            </div>
          )}
          <Input label={`Quantity${itemSel ? ` (${itemSel.unit})` : ''} *`} type="number" min="0.01" step="0.01"
            value={qty} onChange={e => setQty(e.target.value)} placeholder="0" />
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Date</label>
            <div className="flex gap-2">
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input flex-1" />
              <button onClick={() => setDate(today())} className="btn-secondary btn-sm px-3">Today</button>
              <button onClick={() => setDate(yesterday())} className="btn-secondary btn-sm px-3">Yesterday</button>
            </div>
          </div>
          <Input label="Logged By" value={loggedBy} onChange={e => setLoggedBy(e.target.value)} placeholder="Your name" />
        </div>
      </Modal>
    </div>
  )
}
