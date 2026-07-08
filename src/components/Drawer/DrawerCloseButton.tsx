import { X } from 'lucide-react'

type DrawerCloseButtonProps = {
  onClick: () => void
  className?: string
  variant?: 'default' | 'onDark'
  'aria-label'?: string
}

export function DrawerCloseButton({
  onClick,
  className,
  variant = 'default',
  'aria-label': ariaLabel = '关闭',
}: DrawerCloseButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={[
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition focus-visible:outline-none focus-visible:ring-2',
        variant === 'onDark'
          ? 'border-white/20 bg-white/10 text-white hover:bg-white/20 focus-visible:ring-white/40'
          : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800 focus-visible:ring-[#2f8f87]/30',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <X className="h-4 w-4" aria-hidden />
    </button>
  )
}
