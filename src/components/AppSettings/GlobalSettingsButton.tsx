import { useState } from 'react'
import { Settings } from 'lucide-react'
import { GlobalSettingsModal } from './GlobalSettingsModal'

export function GlobalSettingsButton() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
        aria-label="系统设置"
        title="系统设置"
      >
        <Settings className="h-4 w-4" aria-hidden />
      </button>
      <GlobalSettingsModal isOpen={open} onClose={() => setOpen(false)} />
    </>
  )
}
