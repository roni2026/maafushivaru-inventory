import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  ListTodo, Plus, Trash2, RefreshCw, Clock, CheckCircle2, Loader2, CircleDot, X,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Input, { Textarea } from '../components/ui/Input'

const STATUS = {
  pending: { label: 'Pending', variant: 'gray',   icon: CircleDot },
  working: { label: 'Working', variant: 'orange', icon: Loader2 },
  done:    { label: 'Done',    variant: 'green',  icon: CheckCircle2 },
}

const fmtDue = (iso) => {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  } catch { return iso }
}

export default function Tasks() {
  const [tasks, setTasks]     = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [form, setForm]       = useState({ title: '', details: '', date: '', time: '' })
  const [filter, setFilter]   = useState('open') // open | all | done

  const f = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }))

  const load = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('store_tasks')
      .select('*')
      .order('due_at', { ascending: true, nullsFirst: false })
    if (error) toast.error(error.message)
    setTasks(data || [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const create = async () => {
    if (!form.title.trim()) { toast.error('Enter a task title'); return }
    let due_at = null
    if (form.date) {
      const time = form.time || '09:00'
      const d = new Date(`${form.date}T${time}`)
      if (!isNaN(d)) due_at = d.toISOString()
    }
    setSaving(true)
    const { error } = await supabase.from('store_tasks').insert({
      title: form.title.trim(),
      details: form.details.trim() || null,
      due_at,
      status: 'pending',
    })
    setSaving(false)
    if (error) { toast.error(error.message); return }
    toast.success('Task created')
    setForm({ title: '', details: '', date: '', time: '' })
    setShowAdd(false)
    load()
  }

  const setStatus = async (id, status) => {
    const { error } = await supabase.from('store_tasks').update({ status }).eq('id', id)
    if (error) { toast.error(error.message); return }
    setTasks((t) => t.map((x) => (x.id === id ? { ...x, status } : x)))
  }

  const remove = async (id) => {
    if (!confirm('Delete this task?')) return
    const { error } = await supabase.from('store_tasks').delete().eq('id', id)
    if (error) { toast.error(error.message); return }
    setTasks((t) => t.filter((x) => x.id !== id))
    toast.success('Task deleted')
  }

  const visible = useMemo(() => {
    let list = [...tasks]
    if (filter === 'open') list = list.filter((t) => t.status !== 'done')
    if (filter === 'done') list = list.filter((t) => t.status === 'done')
    // Open tasks first, then by due date.
    const rank = { working: 0, pending: 1, done: 2 }
    list.sort((a, b) => (rank[a.status] - rank[b.status]) ||
      String(a.due_at || '9999').localeCompare(String(b.due_at || '9999')))
    return list
  }, [tasks, filter])

  const counts = useMemo(() => ({
    pending: tasks.filter((t) => t.status === 'pending').length,
    working: tasks.filter((t) => t.status === 'working').length,
    done:    tasks.filter((t) => t.status === 'done').length,
  }), [tasks])

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2"><ListTodo className="w-6 h-6 text-[#00AEEF]" /> Store Tasks</h1>
          <p className="page-sub">
            {counts.pending} pending · <span className="text-orange-400">{counts.working} working</span> · <span className="text-green-400">{counts.done} done</span>
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="btn-ghost btn-sm" title="Refresh"><RefreshCw className="w-4 h-4" /></button>
          <Button onClick={() => setShowAdd((s) => !s)}><Plus className="w-4 h-4" /> New Task</Button>
        </div>
      </div>

      {showAdd && (
        <div className="card space-y-3">
          <Input label="Title *" value={form.title} onChange={f('title')} placeholder="e.g. Count beverage fridge stock" />
          <Textarea label="Details" value={form.details} onChange={f('details')} placeholder="Optional notes…" rows={2} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Due date" type="date" value={form.date} onChange={f('date')} />
            <Input label="Due time" type="time" value={form.time} onChange={f('time')} />
          </div>
          <p className="text-xs text-slate-500">A reminder with an alert sound fires on the mobile app at the due time.</p>
          <div className="flex gap-2">
            <Button onClick={create} loading={saving}><CheckCircle2 className="w-4 h-4" /> Create</Button>
            <Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="flex gap-1 bg-slate-800 border border-slate-700 rounded-lg p-1 w-fit">
        {[{ k: 'open', l: 'Open' }, { k: 'done', l: 'Done' }, { k: 'all', l: 'All' }].map((o) => (
          <button key={o.k} onClick={() => setFilter(o.k)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${filter === o.k ? 'bg-[#00AEEF] text-white' : 'text-slate-400 hover:text-slate-100'}`}>
            {o.l}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-10 h-10 border-4 border-[#00AEEF] border-t-transparent rounded-full animate-spin" /></div>
      ) : visible.length === 0 ? (
        <div className="card text-center text-slate-500 py-12">No tasks here. Create one with “New Task”.</div>
      ) : (
        <div className="space-y-2">
          {visible.map((t) => {
            const st = STATUS[t.status] || STATUS.pending
            const overdue = t.due_at && t.status !== 'done' && new Date(t.due_at) < new Date()
            return (
              <div key={t.id} className={`card flex items-start justify-between gap-4 ${t.status === 'done' ? 'opacity-60' : ''}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className={`font-medium text-slate-100 ${t.status === 'done' ? 'line-through' : ''}`}>{t.title}</p>
                    <Badge variant={st.variant}>{st.label}</Badge>
                    {overdue && <Badge variant="red">overdue</Badge>}
                  </div>
                  {t.details && <p className="text-sm text-slate-400 mt-1 whitespace-pre-wrap">{t.details}</p>}
                  {t.due_at && (
                    <p className={`text-xs mt-1.5 flex items-center gap-1 ${overdue ? 'text-red-400' : 'text-slate-500'}`}>
                      <Clock className="w-3.5 h-3.5" /> {fmtDue(t.due_at)}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {['pending', 'working', 'done'].map((s) => (
                    <button key={s} onClick={() => setStatus(t.id, s)}
                      title={STATUS[s].label}
                      className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${t.status === s ? 'bg-[#00AEEF] text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-100 border border-slate-700'}`}>
                      {STATUS[s].label}
                    </button>
                  ))}
                  <button onClick={() => remove(t.id)} className="btn-ghost btn-sm text-red-400 ml-1" title="Delete">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
