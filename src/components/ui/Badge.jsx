const VARIANTS = {
  default: 'bg-slate-700 text-slate-300',
  teal:    'bg-teal-900/60 text-teal-300 border border-teal-700/60',
  green:   'bg-green-900/60 text-green-300 border border-green-700/60',
  yellow:  'bg-yellow-900/60 text-yellow-300 border border-yellow-700/60',
  orange:  'bg-orange-900/60 text-orange-300 border border-orange-700/60',
  red:     'bg-red-900/60 text-red-300 border border-red-700/60',
  blue:    'bg-blue-900/60 text-blue-300 border border-blue-700/60',
  purple:  'bg-purple-900/60 text-purple-300 border border-purple-700/60',
  gray:    'bg-slate-700/60 text-slate-400 border border-slate-600/60',
}

export default function Badge({ children, variant = 'default', className = '' }) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold',
        VARIANTS[variant] || VARIANTS.default,
        className,
      ].join(' ')}
    >
      {children}
    </span>
  )
}
