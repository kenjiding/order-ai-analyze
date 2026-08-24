import { useEffect, useRef, useState } from 'react'
import { Truck, Info } from 'lucide-react'
import Modal from '../Modal'
import { useAppSettings } from '../../context/AppSettingsContext'
import {
  normalizeZktAttendanceSettings,
  type ZktAttendanceSettings,
} from '../../imile/zktAttendanceSettings'
import { ZktDepartmentCascader } from './ZktDepartmentCascader'
import { TokenAlertContactPicker } from './TokenAlertContactPicker'
import {
  normalizeTokenAlertContacts,
  type TokenAlertContacts,
} from '../../imile/tokenAlertContacts'
import { showToast } from '../../utils/toast'

export type SettingsSectionId = 'imile' | 'general'

const SECTIONS: { id: SettingsSectionId; label: string; icon: typeof Truck }[] = [
  { id: 'imile', label: 'iMile 接口', icon: Truck },
  { id: 'general', label: '通用说明', icon: Info },
]

type ImileSettingsDraft = {
  imileToken: string
  zktAttendance: ZktAttendanceSettings
  tokenAlertContacts: TokenAlertContacts
}

type Props = {
  isOpen: boolean
  onClose: () => void
}

function buildDraftFromSettings(input: {
  imileToken: string
  zktAttendance: ZktAttendanceSettings
  tokenAlertContacts: TokenAlertContacts
}): ImileSettingsDraft {
  return {
    imileToken: input.imileToken,
    zktAttendance: normalizeZktAttendanceSettings(input.zktAttendance),
    tokenAlertContacts: normalizeTokenAlertContacts(input.tokenAlertContacts),
  }
}

export function GlobalSettingsModal({ isOpen, onClose }: Props) {
  const { imileToken, zktAttendance, tokenAlertContacts, updateSettings } = useAppSettings()
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('imile')
  const [draft, setDraft] = useState<ImileSettingsDraft>(() =>
    buildDraftFromSettings({ imileToken, zktAttendance, tokenAlertContacts }),
  )
  const [saving, setSaving] = useState(false)
  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setDraft(buildDraftFromSettings({ imileToken, zktAttendance, tokenAlertContacts }))
      setActiveSection('imile')
      setSaving(false)
    }
    wasOpenRef.current = isOpen
  }, [isOpen, imileToken, zktAttendance, tokenAlertContacts])

  const handleSave = async () => {
    if (saving) return
    setSaving(true)
    try {
      const result = await updateSettings(draft)
      if (!result.ok) {
        showToast(result.error || '设置保存失败', 'error')
        return
      }
      showToast('设置已保存', 'success')
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="系统设置"
      maxWidth="max-w-4xl"
      showCloseButton
      footer={
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/80 px-5 py-4 sm:px-6">
          <button type="button" onClick={onClose} disabled={saving} className="admin-btn px-4 py-2">
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="admin-btn admin-btn-primary px-5 py-2 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? '保存中…' : '保存'}
          </button>
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
              <p className="text-xs text-slate-500">
                Token 与考勤 API 配置将保存到服务器并绑定当前账号，用同一账号在其他电脑登录后自动生效。
              </p>

              <div>
                <span className="block text-base font-semibold text-slate-950">token 失效联系人</span>
                <div className="mt-3">
                  <TokenAlertContactPicker
                    active={isOpen && activeSection === 'imile'}
                    value={draft.tokenAlertContacts}
                    onChange={(tokenAlertContacts) => setDraft((prev) => ({ ...prev, tokenAlertContacts }))}
                  />
                </div>
              </div>

              <div className="border-t border-slate-200 pt-4">
                <h4 className="text-base font-semibold text-slate-950">ZKT 考勤 API</h4>
                <p className="mt-1 text-xs text-slate-500">
                  物流运营工作台 API 模式拉取考勤时使用；会话过期后由服务端自动重新登录。
                </p>
                <div className="mt-3 grid max-w-xl gap-3 sm:grid-cols-2">
                  <label className="block text-sm font-medium text-slate-700">
                    账号
                    <input
                      type="text"
                      autoComplete="username"
                      value={draft.zktAttendance.username}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          zktAttendance: { ...prev.zktAttendance, username: e.target.value },
                        }))
                      }
                      placeholder="如 AUS_ADL"
                      className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-[#2f8f87] focus:outline-none focus:ring-2 focus:ring-[#2f8f87]/25"
                    />
                  </label>
                  <label className="block text-sm font-medium text-slate-700">
                    密码
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={draft.zktAttendance.password}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          zktAttendance: { ...prev.zktAttendance, password: e.target.value },
                        }))
                      }
                      className="mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-[#2f8f87] focus:outline-none focus:ring-2 focus:ring-[#2f8f87]/25"
                    />
                  </label>
                  <div className="sm:col-span-2">
                    <span className="block text-sm font-medium text-slate-700">departments（部门）</span>
                    <ZktDepartmentCascader
                      username={draft.zktAttendance.username}
                      password={draft.zktAttendance.password}
                      value={draft.zktAttendance.departmentId}
                      onChange={(departmentId) =>
                        setDraft((prev) => ({
                          ...prev,
                          zktAttendance: { ...prev.zktAttendance, departmentId },
                        }))
                      }
                    />
                    <p className="mt-1 text-xs text-slate-500">
                      多选部门将以逗号分隔 ID 传给考勤接口，例如 16,27。
                    </p>
                  </div>
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
