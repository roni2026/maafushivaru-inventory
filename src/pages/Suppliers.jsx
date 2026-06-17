import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { Plus, Search, Trash2, Edit2, Upload, X, RefreshCw, Building2, Mail, Phone } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Table, { Thead, Tbody, Th, Td, Tr } from '../components/ui/Table'
import Modal from '../components/ui/Modal'
import Input, { Textarea } from '../components/ui/Input'
import CSVImportModal from '../components/CSVImportModal'
import { CSV_CONFIGS } from '../lib/csvTemplates'

const EMPTY = { name: '', contact_name: '', email: '', phone: '', address: '', payment_terms: '', notes: '' }

export default function Suppliers() {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [showCSV, setShowCSV] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form,    setForm]    = useState(EMPTY)
  const [saving,  setSaving]  = useState(false)

  const load = async () => {
    setLoading(true)
    const { data } = await supabase.from('suppliers').select('*').order('name')
    setRecords(data || []); setLoading(false)
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => records.filter(r =>
    !search ||
    r.name?.toLowerCase().includes(search.toLowerCase()) ||
    r.contact_name?.toLowerCase().includes(search.toLowerCase()) ||
    r.email?.toLowerCase().includes(search.toLowerCase())
  ), [records, search])

  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  const openAdd = () => { setEditing(null); setForm(EMPTY); setShowAdd(true) }
  const openEdit = (r) => { setEditing(r.id); setForm({ name: r.name, contact_name: r.contact_name || '', email: r.email || '', phone: r.phone || '', address: r.address || '', payment_terms: r.payment_terms || '', notes: r.notes || '' }); setShowAdd(true) }

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Supplier name is required'); return }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) { toast.error('Invalid email'); return }
    setSaving(true)
    const payload = { name: form.name.trim(), contact_name: form.contact_name.trim(), email: form.email.trim(), phone: form.phone.trim(), address: form.address.trim(), payment_terms: form.payment_terms.trim(), notes: form.notes.trim() }
    const { error } = editing
      ? await supabase.from('suppliers').update(payload).eq('id', editing)
      : await supabase.from('suppliers').insert(payload)
    if (error) { toast.error(error.message); setSaving(false); return }
    toast.success(editing ? 'Supplier updated' : 'Supplier added'); setShowAdd(false); load(); setSaving(false)
  }

  const handleDelete = async (id, name) => {
    if (!confirm(`Delete supplier "${name}"?`)) return
    await supabase.from('suppliers').delete().eq('id', id)
    toast.success('Deleted'); load()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Suppliers</h1>
          <p className="page-sub">Manage your supplier contact database</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={load} className="btn-ghost btn-sm"><RefreshCw className="w-4 h-4" /></button>
          <button onClick={() => setShowCSV(true)} className="btn-secondary btn-sm"><Upload className="w-4 h-4" /> Import CSV</button>
          <Button onClick={openAdd}><Plus className="w-4 h-4" /> Add Supplier</Button>
        </div>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input placeholder="Search supplier, contact or email…" value={search} onChange={e => setSearch(e.target.value)} className="input pl-9 text-sm" />
        {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2"><X className="w-4 h-4 text-slate-400" /></button>}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-10 h-10 border-4 border-[#00AEEF] border-t-transparent rounded-full animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-20 text-slate-500">
          <Building2 className="w-14 h-14 mx-auto mb-4 opacity-20" />
          <p className="font-medium text-lg">No suppliers yet</p>
          <p className="text-sm mt-1">Add suppliers manually or import a CSV file</p>
          <div className="flex gap-2 justify-center mt-5">
            <button onClick={() => setShowCSV(true)} className="btn-secondary btn-sm"><Upload className="w-4 h-4" /> Import CSV</button>
            <Button onClick={openAdd}><Plus className="w-4 h-4" /> Add Supplier</Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(r => (
            <div key={r.id} className="card border border-slate-700/40 hover:border-[#00AEEF]/30 transition-colors">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 bg-[#00AEEF]/10 border border-[#00AEEF]/20 rounded-xl flex items-center justify-center shrink-0">
                    <Building2 className="w-4 h-4 text-[#00AEEF]" />
                  </div>
                  <div>
                    <p className="font-semibold text-slate-100 text-sm">{r.name}</p>
                    {r.contact_name && <p className="text-xs text-slate-400 mt-0.5">{r.contact_name}</p>}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => openEdit(r)} className="p-1.5 text-slate-500 hover:text-[#00AEEF] hover:bg-[#00AEEF]/10 rounded-lg transition-colors"><Edit2 className="w-3.5 h-3.5" /></button>
                  <button onClick={() => handleDelete(r.id, r.name)} className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-900/20 rounded-lg transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
              <div className="mt-3 space-y-1.5 text-xs">
                {r.email && <div className="flex items-center gap-2 text-slate-400"><Mail className="w-3.5 h-3.5 shrink-0" /><a href={`mailto:${r.email}`} className="hover:text-[#00AEEF] transition-colors truncate">{r.email}</a></div>}
                {r.phone && <div className="flex items-center gap-2 text-slate-400"><Phone className="w-3.5 h-3.5 shrink-0" /><span>{r.phone}</span></div>}
                {r.payment_terms && <div className="flex items-center gap-2"><span className="text-slate-500">Terms:</span><span className="text-slate-300">{r.payment_terms}</span></div>}
              </div>
              {r.notes && <p className="text-xs text-slate-500 mt-2 border-t border-slate-700/40 pt-2 truncate">{r.notes}</p>}
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <Modal isOpen onClose={() => setShowAdd(false)} title={editing ? 'Edit Supplier' : 'Add Supplier'} size="sm"
          footer={<><Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button><Button onClick={handleSave} loading={saving}>Save</Button></>}>
          <div className="space-y-4">
            <Input label="Company Name *" value={form.name} onChange={f('name')} placeholder="e.g. Maldives Fresh Co" />
            <Input label="Contact Person" value={form.contact_name} onChange={f('contact_name')} placeholder="Full name" />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Email" type="email" value={form.email} onChange={f('email')} placeholder="contact@supplier.com" />
              <Input label="Phone / WhatsApp" value={form.phone} onChange={f('phone')} placeholder="+960 300 1234" />
            </div>
            <Input label="Address" value={form.address} onChange={f('address')} placeholder="City, Country" />
            <Input label="Payment Terms" value={form.payment_terms} onChange={f('payment_terms')} placeholder="e.g. Net 30, COD, Advance" />
            <Textarea label="Notes" value={form.notes} onChange={f('notes')} rows={2} />
          </div>
        </Modal>
      )}

      {showCSV && <CSVImportModal config={CSV_CONFIGS.suppliers} onClose={() => setShowCSV(false)} onImported={load} />}
    </div>
  )
}
