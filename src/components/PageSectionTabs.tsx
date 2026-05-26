import type { LucideIcon } from 'lucide-react'

export type PageSectionTabItem = {
  id: string
  label: string
  icon?: LucideIcon
}

type Props = {
  activeId: string
  items: PageSectionTabItem[]
  onChange: (id: string) => void
}

export function PageSectionTabs({ activeId, items, onChange }: Props) {
  return (
    <div className="border-b border-slate-200 bg-slate-50 px-5 py-3">
      <div className="flex flex-wrap gap-6 sm:space-x-8 sm:gap-0">
        {items.map((t) => {
          const Icon = t.icon
          const active = activeId === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onChange(t.id)}
              className={[
                'pb-2 px-1 border-b-2 font-medium text-sm transition-colors flex items-center gap-2',
                active
                  ? 'border-[#2f8f87] text-[#2f8f87]'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
              ].join(' ')}
            >
              {Icon ? <Icon className="w-4 h-4 shrink-0" aria-hidden /> : null}
              {t.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
