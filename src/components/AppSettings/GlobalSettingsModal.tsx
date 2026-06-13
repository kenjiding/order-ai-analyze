import { useEffect, useMemo, useRef, useState } from 'react'
import { Truck, Info } from 'lucide-react'
import Modal from '../Modal'
import { useAppSettings } from '../../context/AppSettingsContext'
import {
  DEFAULT_IMILE_PORTAL_SETTINGS,
  normalizeImilePortalSettings,
  type ImilePortalSettings,
} from '../../imile/imilePortalSettings'
import { showToast } from '../../utils/toast'

export type SettingsSectionId = 'imile' | 'general'

const SECTIONS: { id: SettingsSectionId; label: string; icon: typeof Truck }[] = [
  { id: 'imile', label: 'iMile 接口', icon: Truck },
  { id: 'general', label: '通用说明', icon: Info },
]

type ImileSettingsDraft = {
  imileToken: string
  rememberImileToken: boolean
  imilePortal: ImilePortalSettings
}

type Props = {
  isOpen: boolean
  onClose: () => void
}

function portalDraftEqual(a: ImilePortalSettings, b: ImilePortalSettings): boolean {
  const left = normalizeImilePortalSettings(a)
  const right = normalizeImilePortalSettings(b)
  return (
    left.hubcode === right.hubcode &&
    left.resourceCode === right.resourceCode &&
    left.userCode === right.userCode
  )
}

function buildDraftFromSettings(input: {
  imileToken: string
  rememberImileToken: boolean
  imilePortal: ImilePortalSettings
}): ImileSettingsDraft {
  return {
    imileToken: input.imileToken,
    rememberImileToken: input.rememberImileToken,
    imilePortal: normalizeImilePortalSettings(input.imilePortal),
  }
}

export function GlobalSettingsModal({ isOpen, onClose }: Props) {
  const {
    imileToken,
    setImileToken,
    rememberImileToken,
    setRememberImileToken,
    imilePortal,
    setImilePortal,
  } = useAppSettings()
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('imile')
  const [draft, setDraft] = useState<ImileSettingsDraft>(() =>
    buildDraftFromSettings({ imileToken, rememberImileToken, imilePortal }),
  )
  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setDraft(buildDraftFromSettings({ imileToken, rememberImileToken, imilePortal }))
      setActiveSection('imile')
    }
    wasOpenRef.current = isOpen
  }, [isOpen, imileToken, rememberImileToken, imilePortal])

  const savedDraft = useMemo(
    () => buildDraftFromSettings({ imileToken, rememberImileToken, imilePortal }),
    [imileToken, rememberImileToken, imilePortal],
  )

  const isDirty = useMemo(() => {
    if (draft.imileToken !== savedDraft.imileToken) return true
    if (draft.rememberImileToken !== savedDraft.rememberImileToken) return true
    return !portalDraftEqual(draft.imilePortal, savedDraft.imilePortal)
  }, [draft, savedDraft])

  const handleRequestClose = () => {
    if (isDirty && !window.confirm('有未保存的修改，确定放弃吗？')) return
    onClose()
  }

  const handleSave = () => {
    setImileToken(draft.imileToken)
    setRememberImileToken(draft.rememberImileToken)
    setImilePortal(draft.imilePortal)
    showToast('设置已保存', 'success')
    onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleRequestClose}
      title="系统设置"
      maxWidth="max-w-4xl"
      showCloseButton
      footer={
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/80 px-5 py-4 sm:px-6">
          <p className="text-xs text-slate-500">
            {isDirty ? '有未保存的修改' : '已与当前配置同步'}
          </p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={handleRequestClose} className="admin-btn px-4 py-2">
              取消
            </button>
            <button
              type="button"
              disabled={!isDirty}
              onClick={handleSave}
              className="admin-btn admin-btn-primary px-5 py-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              保存
            </button>
          </div>
        </div>
      }
    >
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
                  用于后端代理调用 iMile 轨迹接口（Authorization）。点击「保存」后才会写入本机
                  localStorage（若勾选记住）。
                </p>
              </div>
              <label className="block text-sm font-medium text-slate-700">
                Token
                <input
                  type="password"
                  autoComplete="off"
                  value={draft.imileToken}
                  onChange={(e) => setDraft((prev) => ({ ...prev, imileToken: e.target.value }))}
                  placeholder="粘贴 Authorization 中的 token 段"
                  className="mt-1.5 w-full max-w-xl rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-[#2f8f87] focus:outline-none focus:ring-2 focus:ring-[#2f8f87]/25"
                />
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-[#2f8f87] accent-[#2f8f87]"
                  checked={draft.rememberImileToken}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, rememberImileToken: e.target.checked }))
                  }
                />
                记住 Token 与门户配置（仅存本机 localStorage）
              </label>

              <div className="border-t border-slate-200 pt-4">
                <h4 className="text-base font-semibold text-slate-950">iMile 门户上下文</h4>
                <p className="mt-1 text-sm text-slate-600">
                  与浏览器 DevTools 中 ScanQuery 请求头一致。配置错误会导致 operator 显示为 system
                  或数据与控制台不一致。
                </p>
                <div className="mt-3 grid max-w-xl gap-3 sm:grid-cols-2">
                  <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
                    hubcode
                    <input
                      type="text"
                      autoComplete="off"
                      value={draft.imilePortal.hubcode}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          imilePortal: { ...prev.imilePortal, hubcode: e.target.value },
                        }))
                      }
                      placeholder={DEFAULT_IMILE_PORTAL_SETTINGS.hubcode}
                      className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-sm focus:border-[#2f8f87] focus:outline-none focus:ring-2 focus:ring-[#2f8f87]/25"
                    />
                  </label>
                  <label className="block text-sm font-medium text-slate-700">
                    resource-code
                    <input
                      type="text"
                      autoComplete="off"
                      value={draft.imilePortal.resourceCode}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          imilePortal: { ...prev.imilePortal, resourceCode: e.target.value },
                        }))
                      }
                      placeholder={DEFAULT_IMILE_PORTAL_SETTINGS.resourceCode}
                      className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-sm focus:border-[#2f8f87] focus:outline-none focus:ring-2 focus:ring-[#2f8f87]/25"
                    />
                  </label>
                  <label className="block text-sm font-medium text-slate-700">
                    userCode（front-sec）
                    <input
                      type="text"
                      autoComplete="off"
                      value={draft.imilePortal.userCode}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          imilePortal: { ...prev.imilePortal, userCode: e.target.value },
                        }))
                      }
                      placeholder="如 2106851401"
                      className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-sm focus:border-[#2f8f87] focus:outline-none focus:ring-2 focus:ring-[#2f8f87]/25"
                    />
                  </label>
                </div>
              </div>
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
