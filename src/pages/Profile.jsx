import { useState, useEffect, useCallback } from 'react'
import { UserCircle, Save, KeyRound } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/supabase'
import { getCurrentProfile, updateCurrentProfile } from '../lib/profile'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'

// Every signed-in user gets a Profile section where they can update their
// own personal information (name, phone, role/title) and change their
// password. Waste Log and other "who did this" fields use `full_name`
// from here automatically instead of asking for it each time.
export default function Profile() {
  const [profile,  setProfile]  = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [fullName, setFullName] = useState('')
  const [phone,    setPhone]    = useState('')
  const [roleTitle,setRoleTitle]= useState('')

  const [newPassword, setNewPassword] = useState('')
  const [changingPw,  setChangingPw]  = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const p = await getCurrentProfile()
      setProfile(p)
      setFullName(p?.full_name || '')
      setPhone(p?.phone || '')
      setRoleTitle(p?.role_title || '')
    } catch (err) {
      toast.error('Failed to load profile: ' + err.message)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const save = async () => {
    if (!fullName.trim()) { toast.error('Enter your name'); return }
    setSaving(true)
    try {
      const updated = await updateCurrentProfile({
        full_name: fullName.trim(),
        phone: phone.trim() || null,
        role_title: roleTitle.trim() || null,
      })
      setProfile(prev => ({ ...prev, ...updated }))
      toast.success('Profile updated')
    } catch (err) {
      toast.error(err.message)
    }
    setSaving(false)
  }

  const changePassword = async () => {
    if (newPassword.length < 6) { toast.error('Password must be at least 6 characters'); return }
    setChangingPw(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
      toast.success('Password updated')
      setNewPassword('')
    } catch (err) {
      toast.error(err.message)
    }
    setChangingPw(false)
  }

  if (loading) {
    return <div className="flex justify-center py-16"><div className="w-9 h-9 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h1 className="page-title">My Profile</h1>
        <p className="page-sub">Update your personal information. Your name is used automatically wherever the app needs to know who's logged in (e.g. Waste Log).</p>
      </div>

      <div className="card space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-[#00AEEF] to-teal-700 rounded-full flex items-center justify-center text-lg font-bold text-white shrink-0">
            {(fullName || profile?.email || 'U')[0]?.toUpperCase()}
          </div>
          <div>
            <p className="font-display text-base font-semibold text-slate-100">{fullName || 'Unnamed user'}</p>
            <p className="text-xs text-slate-400">{profile?.email}</p>
          </div>
        </div>

        <Input label="Full Name" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Your full name" />
        <Input label="Phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="Optional" />
        <Input label="Role / Title" value={roleTitle} onChange={e => setRoleTitle(e.target.value)} placeholder="e.g. Inventory Manager" />
        <Input label="Email" value={profile?.email || ''} disabled className="opacity-60 cursor-not-allowed" />

        <div className="flex justify-end pt-1">
          <Button onClick={save} loading={saving}><Save className="w-4 h-4" /> Save Changes</Button>
        </div>
      </div>

      <div className="card space-y-4">
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-teal-400" />
          <h2 className="font-display text-base font-semibold text-slate-100">Change Password</h2>
        </div>
        <Input label="New Password" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="At least 6 characters" />
        <div className="flex justify-end">
          <Button variant="secondary" onClick={changePassword} loading={changingPw} disabled={!newPassword}>Update Password</Button>
        </div>
      </div>
    </div>
  )
}
