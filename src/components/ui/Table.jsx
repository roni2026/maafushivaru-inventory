export default function Table({ children, className = '', maxHeight }) {
  return (
    <div
      className={`overflow-auto rounded-xl border border-slate-700 ${className}`}
      style={maxHeight ? { maxHeight } : undefined}
    >
      <table className="w-full text-sm text-left">{children}</table>
    </div>
  )
}

export function Thead({ children }) {
  return (
    <thead className="bg-slate-700 text-slate-300 text-xs uppercase tracking-wider sticky top-0 z-10 shadow-sm">
      {children}
    </thead>
  )
}

export function Tbody({ children }) {
  return (
    <tbody className="divide-y divide-slate-700/40">{children}</tbody>
  )
}

export function Th({ children, className = '', sortable = false, onClick, sorted }) {
  return (
    <th
      onClick={onClick}
      className={[
        'px-3 py-2 font-semibold whitespace-nowrap',
        sortable ? 'cursor-pointer select-none hover:text-teal-300 transition-colors' : '',
        className,
      ].join(' ')}
    >
      <span className="flex items-center gap-1">
        {children}
        {sortable && sorted !== undefined && (
          <span className="opacity-60 text-teal-400">{sorted === 'asc' ? '↑' : '↓'}</span>
        )}
      </span>
    </th>
  )
}

export function Td({ children, className = '' }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>
}

export function Tr({ children, className = '', onClick }) {
  return (
    <tr
      onClick={onClick}
      className={[
        'transition-colors',
        onClick ? 'cursor-pointer hover:bg-slate-700/30' : '',
        className,
      ].join(' ')}
    >
      {children}
    </tr>
  )
}
