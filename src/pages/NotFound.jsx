import { Link, useLocation } from 'react-router-dom'
import { Compass, ArrowLeft } from 'lucide-react'

export default function NotFound() {
  const { pathname } = useLocation()
  return (
    <div className="flex flex-col items-center justify-center text-center min-h-[60vh] gap-4">
      <div className="w-16 h-16 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center">
        <Compass className="w-8 h-8 text-teal-400" />
      </div>
      <h1 className="font-display text-3xl font-bold text-slate-100">Page not found</h1>
      <p className="text-slate-400 max-w-md">
        The page <code className="text-teal-400 bg-slate-800 px-1.5 py-0.5 rounded">{pathname}</code> doesn’t exist.
        It may have been moved, or the link is incorrect.
      </p>
      <Link to="/" className="btn-secondary btn-sm mt-2">
        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
      </Link>
    </div>
  )
}
