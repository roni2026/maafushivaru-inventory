// ReportClaimModal.jsx
// Reusable modal for logging a delivery claim (wrong item, short delivery, damaged, etc.)
// Can be triggered from Orders history, Receiving page, or Claims page.

import { useState, useEffect } from 'react'
import { supabase, selectAll } from '../lib/supabase'
import { AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from './ui/Modal'
import Button from './ui/Button'
import Input, { Select, Textarea } from './ui/Input'

export const ISSUE_TYPES = [
  { value: 'wrong_item',      label: '❌ Wrong Item',         desc: 'Completely different item delivered' },
  { value: 'short_delivery',  label: '📉 Short Delivery',     desc: 'Less quantity than ordered' },
  { value: 'damaged',         label: '💥 Damaged',            desc: 'Item arrived damaged or broken' },
  { value: 'expired',         label: '⏰ Expired / Near Expiry', desc: 'Item was expired or unacceptably close to expiry' },
  { value: 'wrong_spec',      label: '📋 Wrong Specification', desc: 'Wrong size, brand, or variant' },
  { value: 'other',           label: '⚠ Other',               desc: 'Other issue' },
]

export const ISSUE_BADGE_VARIANT = {
  wrong_item:     'red',
  short_delivery: 'orange',
  damaged:        'red',
  expired:        'yellow',
  wrong_spec:     'orange',
  other:          'gray',
}

export default function ReportClaimModal({ prefill = {}, onClose, onSaved }) {
  const [saving, setSaving] = useState(false)
  const [items,  setItems]  = useState([])
  const [form,   setForm]   = useState({
    date:          new Date().toISOString().split('T')[0],
    item_name:     prefill.item_name    || '',
    part_number:   prefill.part_number  || '',
    store_name:    prefill.store_name   || '',
    supplier_name: prefill.supplier     || '',
    ordered_qty:   prefill.ordered_qty  ?? '',
    received_qty:  prefill.received_qty ?? '',
    wrong_qty:     prefill.wrong_qty    ?? '',
    unit:          prefill.unit         || 'pcs',
    issue_type:    prefill.issue_type   || 'wrong_item',
    notes:         '',
    item_id:       prefill.item_id      || null,
    order_id:      prefill.order_id     || null,
  })

  // If no item prefilled, allow searching inventory
  const [itemSearch, setItemSearch] = useState(prefill.item_name || '')
  const [showDropdown, setShowDropdown] = useState(false)
  const filteredItems = items.filter(i =>
    i.name.toLowerCase().includes(itemSearch.toLowerCase()) ||
    i.part_number.toLowerCase().includes(itemSearch.toLowerCase())
  ).slice(0, 8)

  useEffect(() => {
    // Load items only if no item was prefilled (manual claim entry)
    if (!prefill.item_id) {
      selectAll(() => supabase.from('items').select('id,name,part_number,unit,supplier,stores(name)').order('name'))
        .then(({ data }) => setItems(data || []))
    }
  }, [prefill.item_id])

  const selectItem = (item) => {
    setForm(f => ({
      ...f,
      item_id:       item.id,
      item_name:     item.name,
      part_number:   item.part_number,
      unit:          item.unit,
      store_name:    item.stores?.name || '',
      supplier_name: f.supplier_name || item.supplier || '',
    }))
    setItemSearch(item.name)
    setShowDropdown(false)
  }

  const f = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }))

  const validate = () => {
    if (!form.item_name.trim())     { toast.error('Enter item name'); return false }
    if (!form.supplier_name.trim()) { toast.error('Enter supplier name'); return false }
    if (!form.wrong_qty || Number(form.wrong_qty) <= 0) { toast.error('Enter wrong/short quantity'); return false }
    return true
  }

  const handleSave = async () => {
    if (!validate()) return
    setSaving(true)
    try {
      const { error } = await supabase.from('delivery_claims').insert({
        date:          form.date,
        order_id:      form.order_id     || null,
        item_id:       form.item_id      || null,
        item_name:     form.item_name.trim(),
        part_number:   form.part_number.trim(),
        store_name:    form.store_name.trim(),
        supplier_name: form.supplier_name.trim(),
        ordered_qty:   Number(form.ordered_qty)  || 0,
        received_qty:  Number(form.received_qty) || 0,
        wrong_qty:     Number(form.wrong_qty),
        unit:          form.unit,
        issue_type:    form.issue_type,
        notes:         form.notes.trim(),
        status:        'pending',
      })
      if (error) throw error
      toast.success('Claim logged — supplier will be tracked.')
      onSaved?.()
      onClose()
    } catch (err) {
      toast.error('Failed: ' + err.message)
    }
    setSaving(false)
  }

  const selected = ISSUE_TYPES.find(t => t.value === form.issue_type)

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Report Delivery Issue"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} loading={saving} variant="danger">
            <AlertTriangle className="w-4 h-4" /> Log Claim
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* Issue type selector */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">Issue Type *</label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {ISSUE_TYPES.map(type => (
              <button
                key={type.value}
                onClick={() => setForm(f => ({ ...f, issue_type: type.value }))}
                className={[
                  'text-left p-2.5 rounded-xl border text-xs transition-all',
                  form.issue_type === type.value
                    ? 'border-red-500 bg-red-900/20 text-red-300'
                    : 'border-slate-600 bg-slate-700/30 text-slate-400 hover:border-slate-500',
                ].join(' ')}
              >
                <div className="font-medium">{type.label}</div>
                <div className="text-slate-500 mt-0.5 text-[10px]">{type.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Date *" type="date" value={form.date} onChange={f('date')} />

          {/* Item selector */}
          {prefill.item_id ? (
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Item</label>
              <div className="input bg-slate-700/50 text-slate-200 text-sm flex items-center gap-2">
                <span className="font-mono text-xs text-[#00AEEF]">{form.part_number}</span>
                <span>{form.item_name}</span>
              </div>
            </div>
          ) : (
            <div className="relative">
              <label className="block text-sm font-medium text-slate-300 mb-1">Item *</label>
              <input
                className="input text-sm"
                placeholder="Search item by name or part #…"
                value={itemSearch}
                onChange={e => { setItemSearch(e.target.value); setShowDropdown(true) }}
                onFocus={() => setShowDropdown(true)}
              />
              {showDropdown && filteredItems.length > 0 && (
                <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-600 rounded-xl shadow-lg max-h-48 overflow-y-auto">
                  {filteredItems.map(item => (
                    <button key={item.id} onClick={() => selectItem(item)}
                      className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-slate-700 text-left text-sm">
                      <span className="font-mono text-xs text-[#00AEEF] w-16 shrink-0">{item.part_number}</span>
                      <span className="text-slate-200 truncate">{item.name}</span>
                      <span className="text-slate-500 text-xs shrink-0">{item.stores?.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <Input
            label="Supplier Name *"
            value={form.supplier_name}
            onChange={f('supplier_name')}
            placeholder="e.g. Maldives Fresh Co"
          />
          <Input label="Store" value={form.store_name} onChange={f('store_name')} placeholder="e.g. Beverage Dry Store" />

          <Input
            label={`Ordered Qty ${form.unit ? `(${form.unit})` : ''}`}
            type="number" min="0" step="0.01"
            value={form.ordered_qty} onChange={f('ordered_qty')}
            placeholder="What was ordered"
          />
          <Input
            label={`Received Qty ${form.unit ? `(${form.unit})` : ''}`}
            type="number" min="0" step="0.01"
            value={form.received_qty} onChange={f('received_qty')}
            placeholder="What actually came"
          />
          <div className="sm:col-span-2">
            <Input
              label={`Wrong / Short Qty * ${form.unit ? `(${form.unit})` : ''}`}
              type="number" min="0.01" step="0.01"
              value={form.wrong_qty} onChange={f('wrong_qty')}
              placeholder="Quantity to claim from supplier"
            />
            {form.wrong_qty > 0 && (
              <p className="text-xs text-orange-400 mt-1">
                ⚠ Claiming {form.wrong_qty} {form.unit} of "{form.item_name || 'this item'}" from {form.supplier_name || 'supplier'}
              </p>
            )}
          </div>
          <div className="sm:col-span-2">
            <Textarea
              label="Notes / Details"
              value={form.notes}
              onChange={f('notes')}
              placeholder={`Describe the issue — e.g. "Received ${form.issue_type === 'wrong_item' ? 'a completely different brand' : form.issue_type === 'damaged' ? '3 broken bottles' : 'less than ordered'}"`}
              rows={2}
            />
          </div>
        </div>

        {selected && (
          <div className="bg-red-900/10 border border-red-700/30 rounded-xl p-3 text-sm text-red-300">
            <strong>{selected.label}:</strong> {selected.desc}
          </div>
        )}
      </div>
    </Modal>
  )
}
