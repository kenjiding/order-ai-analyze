import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

type Props = {
  icon: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
}

/** 抽屉/表单里的分组卡片：图标 + 标题 + 说明 + 右侧操作区。 */
export function FormSection({ icon: Icon, title, description, action, children }: Props) {
  return (
    <section className="rounded-xl border border-[var(--admin-line)] bg-white">
      <header className="flex items-center justify-between gap-3 border-b border-[var(--admin-line)] bg-[var(--admin-surface-soft)] px-4 py-3">
        <div className="flex items-start gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]">
            <Icon className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <h4 className="flex h-7 items-center text-sm font-semibold text-slate-800">{title}</h4>
            {description && <p className="text-xs leading-relaxed text-slate-500">{description}</p>}
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      <div className="px-4 py-4">{children}</div>
    </section>
  )
}
