import { Loader2 } from 'lucide-react'

const VARIANTS = {
  primary:   'bg-teal-600 hover:bg-teal-500 text-white',
  secondary: 'bg-slate-700 hover:bg-slate-600 text-slate-100',
  danger:    'bg-red-700 hover:bg-red-600 text-white',
  ghost:     'bg-transparent hover:bg-slate-700 text-slate-400 hover:text-slate-100',
  outline:   'border border-teal-600 text-teal-400 hover:bg-teal-600/10',
  success:   'bg-green-700 hover:bg-green-600 text-white',
}

const SIZES = {
  xs: 'px-2.5 py-1 text-xs',
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-2.5 text-base',
}

export default function Button({
  children,
  variant   = 'primary',
  size      = 'md',
  loading   = false,
  disabled  = false,
  className = '',
  ...props
}) {
  return (
    <button
      disabled={disabled || loading}
      className={[
        'inline-flex items-center gap-2 font-medium rounded-lg transition-colors',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        VARIANTS[variant] || VARIANTS.primary,
        SIZES[size]       || SIZES.md,
        className,
      ].join(' ')}
      {...props}
    >
      {loading && <Loader2 className="w-4 h-4 animate-spin shrink-0" />}
      {children}
    </button>
  )
}
