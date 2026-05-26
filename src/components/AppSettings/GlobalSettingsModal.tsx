import { useState } from 'react'
import { Truck, Info } from 'lucide-react'
import Modal from '../Modal'
import { useAppSettings } from '../../context/AppSettingsContext'

export type SettingsSectionId = 'imile' | 'general'

const SECTIONS: { id: SettingsSectionId; label: string; icon: typeof Truck }[] = [
  { id: 'imile', label: 'iMile 接口', icon: Truck },
  { id: 'general', label: '通用说明', icon: Info },
]

type Props = {
  isOpen: boolean
  onClose: () => void
}

export function GlobalSettingsModal({ isOpen, onClose }: Props) {
  const { imileToken, setImileToken, rememberImileToken, setRememberImileToken } = useAppSettings()
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('imile')

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="系统设置" maxWidth="max-w-4xl" showCloseButton>
      <div className="flex min-h-[min(60vh,420px)] flex-col sm:flex-row">
        <nav
          className="flex shrink-0 flex-row gap-1 border-b border-slate-200 bg-slate-50/80 p-2 sm:w-52 sm:flex-col sm:border-b-0 sm:border-r"
          aria-label="设置分类"
        >
          {SECTIONS.map((s) => {
            const Icon = s.icon
            const active = activeSection === s.id
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveSection(s.id)}
                className={[
                  'flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition',
                  active
                    ? 'bg-white text-[#1f6f68] shadow-sm ring-1 ring-[rgba(47,143,135,0.25)]'
                    : 'text-slate-600 hover:bg-white/70 hover:text-slate-900',
                ].join(' ')}
              >
                <Icon className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
                {s.label}
              </button>
            )
          })}
        </nav>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-5 sm:p-6">
          {activeSection === 'imile' && (
            <div className="space-y-4">
              <div>
                <h4 className="text-base font-semibold text-slate-950">iMile Bearer Token</h4>
                <p className="mt-1 text-sm text-slate-600">
                  用于后端代理调用 iMile 轨迹接口（Authorization）。不会写入 IndexedDB，仅按下方选项存于本机
                  localStorage。
                </p>
              </div>
              <label className="block text-sm font-medium text-slate-700">
                Token
                <input
                  type="password"
                  autoComplete="off"
                  value={imileToken}
                  onChange={(e) => setImileToken(e.target.value)}
                  placeholder="粘贴 Authorization 中的 token 段"
                  className="mt-1.5 w-full max-w-xl rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-[#2f8f87] focus:outline-none focus:ring-2 focus:ring-[#2f8f87]/25"
                />
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-[#2f8f87] accent-[#2f8f87]"
                  checked={rememberImileToken}
                  onChange={(e) => setRememberImileToken(e.target.checked)}
                />
                记住 Token（仅存本机 localStorage）
              </label>
            </div>
          )}

          {activeSection === 'general' && (
            <div className="space-y-3 text-sm leading-relaxed text-slate-700">
              <h4 className="text-base font-semibold text-slate-950">应用说明</h4>
              <p>
                本控制台以本地计算优先：工资与扫码等数据默认保存在浏览器本机；订单异常样本使用 IndexedDB
                持久化。网络请求仅在经过后端代理时使用，敏感凭据请妥善保管。
              </p>
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600">
                顶部栏显示的「离线计算 · 本机存储」表示核心数据不落远端业务库，仍以您在当前浏览器中的存储为准。
              </p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
