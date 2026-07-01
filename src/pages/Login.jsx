import { useState } from 'react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { Waves, Eye, EyeOff } from 'lucide-react'

export default function Login() {
  const [email,        setEmail]        = useState('')
  const [password,     setPassword]     = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading,      setLoading]      = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      toast.error(error.message)
    } else {
      toast.success('Welcome back!')
    }
    setLoading(false)
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden">
      {/* Maldivian island / sea backdrop */}
      <div
        className="absolute inset-0 bg-cover bg-center scale-105"
        style={{ backgroundImage: 'url(/maldives-bg.jpg)' }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-slate-900/55 via-slate-900/65 to-slate-950/85" />

      <div className="relative w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-teal-600/90 backdrop-blur rounded-2xl shadow-xl mb-5 ring-1 ring-white/20">
            <Waves className="w-8 h-8 text-white" />
          </div>
          <h1 className="font-display text-3xl font-bold text-white drop-shadow-lg">Outrigger</h1>
          <p className="text-teal-50/90 mt-1 text-sm drop-shadow">Maafushivaru Resort &mdash; Inventory System</p>
        </div>

        {/* Card — glassmorphic over the lagoon */}
        <div className="bg-slate-900/55 backdrop-blur-xl border border-white/15 rounded-2xl p-8 shadow-2xl">
          <h2 className="font-display text-xl font-semibold text-white mb-6">Sign In</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@resort.com"
                required
                autoComplete="email"
                className="input"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  className="input pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full btn-primary btn-lg justify-center mt-2"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>

        <p className="text-center text-slate-500 text-xs mt-6">
          Contact your system administrator to request access.
        </p>
      </div>
    </div>
  )
}
