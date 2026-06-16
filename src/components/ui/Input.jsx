// A set of controlled form-field primitives

function fieldClass(error) {
  return [
    'w-full bg-slate-700 border rounded-lg px-3 py-2',
    'text-slate-100 placeholder-slate-400',
    'focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all',
    error ? 'border-red-500' : 'border-slate-600',
  ].join(' ')
}

export default function Input({ label, error, className = '', ...props }) {
  return (
    <div className="space-y-1">
      {label && <label className="block text-sm font-medium text-slate-300">{label}</label>}
      <input className={`${fieldClass(error)} ${className}`} {...props} />
      {error && <p className="text-red-400 text-xs">{error}</p>}
    </div>
  )
}

export function Select({ label, error, className = '', children, ...props }) {
  return (
    <div className="space-y-1">
      {label && <label className="block text-sm font-medium text-slate-300">{label}</label>}
      <select className={`${fieldClass(error)} ${className}`} {...props}>
        {children}
      </select>
      {error && <p className="text-red-400 text-xs">{error}</p>}
    </div>
  )
}

export function Textarea({ label, error, rows = 3, className = '', ...props }) {
  return (
    <div className="space-y-1">
      {label && <label className="block text-sm font-medium text-slate-300">{label}</label>}
      <textarea
        rows={rows}
        className={`${fieldClass(error)} resize-none ${className}`}
        {...props}
      />
      {error && <p className="text-red-400 text-xs">{error}</p>}
    </div>
  )
}

export function FormGroup({ label, children, error, hint }) {
  return (
    <div className="space-y-1">
      {label && <label className="block text-sm font-medium text-slate-300">{label}</label>}
      {children}
      {hint  && !error && <p className="text-slate-500 text-xs">{hint}</p>}
      {error && <p className="text-red-400 text-xs">{error}</p>}
    </div>
  )
}
