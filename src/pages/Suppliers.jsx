import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { Building2, Plus, Pencil, Trash2, Search, Phone, Mail, Clock } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import Table, { Thead, Tbody, Th, Td, Tr } from '../components/ui/Table'
import Input, { Textarea } from '../components/ui/Input'

const EMPTY = { name:'', contact_person:'', phone:'', email:'', lead_time_days:7, notes:'' }

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [editId,    setEditId]    = useState(null)
  const [form,      setForm]      = useState(EMPTY)
  const [search,    setSearch]    = useState('')
  const [deleting,  setDeleting]  = useState(null)

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase.from('suppliers').select('*').order('name')
    setSuppliers(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const openAdd = () => { setEditId(null); setForm(EMPTY); setShowModal(true) }
  const openEdit = (s) => { setEditId(s.id); setForm({ name:s.name, contact_person:s.contact_person||'', phone:s.phone||'', email:s.email||'', lead_time_days:s.lead_time_days||7, notes:s.notes||'' }); setShowModal(true) }

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Supplier name is required'); return }
    setSaving(true)
    try {
      const payload = { name:form.name.trim(), contact_person:form.contact_person, phone:form.phone, email:form.email, lead_time_days:Number(form.lead_time_days)||7, notes:form.notes }
      if (editId) {
        const { data } = await supabase.from('suppliers').update(payload).eq('id', editId).select().single()
        setSuppliers(prev => prev.map(s => s.id===editId ? data : s))
        toast.success('Supplier updated')
      } else {
        const { data } = await supabase.from('suppliers').insert(payload).select().single()
        setSuppliers(prev => [...prev, data].sort((a,b)=>a.name.localeCompare(b.name)))
        toast.success('Supplier added')
      }
      setShowModal(false)
    } catch(err) { toast.error(err.message) }
    setSaving(false)
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this supplier?')) return
    setDeleting(id)
    await supabase.from('suppliers').delete().eq('id', id)
    setSuppliers(prev => prev.filter(s => s.id!==id))
    toast.success('Supplier deleted')
    setDeleting(null)
  }

  const filtered = useMemo(() => {
    if (!search) return suppliers
    const q=search.toLowerCase()
    return suppliers.filter(s=>s.name.toLowerCase().includes(q)||s.contact_person?.toLowerCase().includes(q)||s.email?.toLowerCase().includes(q))
  }, [suppliers, search])

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h1 className="page-title">Suppliers</h1><p className="page-sub">Manage your supplier directory and contact information</p></div>
        <Button onClick={openAdd}><Plus className="w-4 h-4" /> Add Supplier</Button>
      </div>

      <div className="card py-3 px-4 flex gap-3 items-center">
        <Search className="w-4 h-4 text-slate-400 shrink-0" />
        <input className="flex-1 bg-transparent text-slate-100 text-sm placeholder-slate-500 focus:outline-none" placeholder="Search suppliers…" value={search} onChange={e=>setSearch(e.target.value)} />
        <span className="text-slate-400 text-sm">{filtered.length} suppliers</span>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : filtered.length===0 ? (
        <div className="card text-center py-16 text-slate-500">
          <Building2 className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="font-medium">No suppliers yet</p>
          <p className="text-sm mt-1">Add your first supplier to build the directory.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(s=>(
            <div key={s.id} className="card border border-slate-700/40 hover:border-teal-700/40 transition-colors">
              <div className="flex items-start justify-between mb-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-100 truncate">{s.name}</p>
                  {s.contact_person&&<p className="text-slate-400 text-sm mt-0.5">{s.contact_person}</p>}
                </div>
                <div className="flex gap-1 shrink-0 ml-2">
                  <button onClick={()=>openEdit(s)} className="p-1.5 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-teal-400 transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                  <button onClick={()=>handleDelete(s.id)} disabled={deleting===s.id} className="p-1.5 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
              <div className="space-y-2">
                {s.phone&&<div className="flex items-center gap-2 text-sm"><Phone className="w-3.5 h-3.5 text-slate-500 shrink-0" /><a href={`tel:${s.phone}`} className="text-teal-400 hover:text-teal-300 truncate">{s.phone}</a></div>}
                {s.email&&<div className="flex items-center gap-2 text-sm"><Mail className="w-3.5 h-3.5 text-slate-500 shrink-0" /><a href={`mailto:${s.email}`} className="text-teal-400 hover:text-teal-300 truncate">{s.email}</a></div>}
                <div className="flex items-center gap-2 text-sm"><Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" /><span className="text-slate-400">Lead time: <strong className="text-slate-300">{s.lead_time_days} days</strong></span></div>
              </div>
              {s.notes&&<p className="mt-3 text-xs text-slate-500 border-t border-slate-700/40 pt-3 line-clamp-2">{s.notes}</p>}
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={showModal} onClose={()=>setShowModal(false)} title={editId?'Edit Supplier':'Add Supplier'} size="sm"
        footer={<><Button variant="secondary" onClick={()=>setShowModal(false)}>Cancel</Button><Button onClick={handleSave} loading={saving}>{editId?'Save Changes':'Add Supplier'}</Button></>}>
        <div className="space-y-4">
          <Input label="Supplier Name *" value={form.name} onChange={e=>set('name',e.target.value)} placeholder="e.g. Maldives Fresh Imports" />
          <Input label="Contact Person" value={form.contact_person} onChange={e=>set('contact_person',e.target.value)} placeholder="e.g. Ahmed Hassan" />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Phone" type="tel" value={form.phone} onChange={e=>set('phone',e.target.value)} placeholder="+960 123 4567" />
            <Input label="Email" type="email" value={form.email} onChange={e=>set('email',e.target.value)} placeholder="supplier@email.com" />
          </div>
          <Input label="Lead Time (days)" type="number" min="1" value={form.lead_time_days} onChange={e=>set('lead_time_days',e.target.value)} />
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Notes</label>
            <textarea className="input min-h-[80px] resize-none" value={form.notes} onChange={e=>set('notes',e.target.value)} placeholder="Payment terms, delivery schedule, etc." />
          </div>
        </div>
      </Modal>
    </div>
  )
}
