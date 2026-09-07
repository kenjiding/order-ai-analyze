import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Input, Modal } from 'antd'
import { KeyRound, Fingerprint, Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'
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

export type SettingsSectionId = 'imile' | 'zkt' | 'about'

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

/** 分区标题：一行标题 + 一行说明，替代原来堆叠的同级 h4 */
function SectionHead({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h4 className="text-[15px] font-semibold tracking-tight text-slate-950">{title}</h4>
      <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
    </div>
  )
}

/** 表单字段：标签在上、控件居中、说明在下，全部分区共用同一节奏 */
function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string
  hint?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={className}>
      <span className="block text-sm font-medium text-slate-700">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint ? <p className="mt-1.5 text-xs leading-5 text-slate-500">{hint}</p> : null}
    </div>
  )
}

function StatusBadge({ configured }: { configured: boolean }) {
  const { t } = useTranslation('common')
  return (
    <span
      className={[
        'ml-auto shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium',
        configured ? 'bg-[#e1f5f1] text-[#1f6f68]' : 'bg-slate-100 text-slate-500',
      ].join(' ')}
    >
      {configured ? t('configured') : t('notConfigured')}
    </span>
  )
}

export function GlobalSettingsModal({ isOpen, onClose }: Props) {
  const { t } = useTranslation('settings')
  const { t: tc } = useTranslation('common')
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
        showToast(result.error || t('saveFailed'), 'error')
        return
      }
      showToast(t('saved'), 'success')
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const sections: { id: SettingsSectionId; label: string; icon: typeof KeyRound; configured?: boolean }[] = [
    {
      id: 'imile',
      label: t('sections.imile'),
      icon: KeyRound,
      configured: Boolean(draft.imileToken.trim()),
    },
    {
      id: 'zkt',
      label: t('sections.zkt'),
      icon: Fingerprint,
      configured: Boolean(draft.zktAttendance.username.trim() && draft.zktAttendance.password),
    },
    { id: 'about', label: t('sections.about'), icon: Info },
  ]

  return (
    <Modal
      open={isOpen}
      onCancel={onClose}
      width={880}
      maskClosable={!saving}
      title={
        <div>
          <div className="text-base font-semibold text-slate-950">{t('title')}</div>
          <div className="mt-0.5 text-xs font-normal text-slate-500">{t('subtitle')}</div>
        </div>
      }
      styles={{ header: { marginBottom: 16 }, body: { padding: 0 }, footer: { marginTop: 16 } }}
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-5 text-slate-500">{t('footerHint')}</p>
          <div className="flex justify-end gap-2">
            <Button onClick={onClose} disabled={saving}>
              {tc('cancel')}
            </Button>
            <Button type="primary" loading={saving} onClick={() => void handleSave()}>
              {tc('save')}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col overflow-hidden rounded-lg border border-[#d8e6ee] sm:h-[min(64vh,460px)] sm:flex-row">
        <nav
          className="flex shrink-0 gap-1 overflow-x-auto border-b border-[#d8e6ee] bg-[#f0f7fb] p-2 sm:w-52 sm:flex-col sm:overflow-x-visible sm:border-b-0 sm:border-r"
          aria-label={t('navLabel')}
        >
          {sections.map((s) => {
            const Icon = s.icon
            const active = activeSection === s.id
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveSection(s.id)}
                aria-current={active ? 'true' : undefined}
                className={[
                  'flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm transition sm:w-full',
                  active
                    ? 'bg-white font-semibold text-[#1f6f68] shadow-[0_1px_2px_rgba(15,23,42,0.06)] ring-1 ring-[#2f8f87]/25'
                    : 'font-medium text-slate-600 hover:bg-white/70 hover:text-slate-900',
                ].join(' ')}
              >
                <Icon className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
                <span className="whitespace-nowrap">{s.label}</span>
                {s.configured === undefined ? null : <StatusBadge configured={s.configured} />}
              </button>
            )
          })}
        </nav>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-white px-5 py-5 sm:px-6">
          {activeSection === 'imile' && (
            <div className="space-y-5">
              <SectionHead title={t('imile.title')} description={t('imile.description')} />
              <Field label={t('imile.tokenLabel')} hint={t('imile.tokenHint')}>
                <Input.Password
                  autoComplete="off"
                  value={draft.imileToken}
                  onChange={(e) => setDraft((prev) => ({ ...prev, imileToken: e.target.value }))}
                  placeholder={t('imile.tokenPlaceholder')}
                />
              </Field>

              <div className="border-t border-[#d8e6ee] pt-5">
                <SectionHead title={t('imile.alertTitle')} description={t('imile.alertDescription')} />
                <div className="mt-4">
                  <TokenAlertContactPicker
                    active={isOpen && activeSection === 'imile'}
                    value={draft.tokenAlertContacts}
                    onChange={(tokenAlertContacts) => setDraft((prev) => ({ ...prev, tokenAlertContacts }))}
                  />
                </div>
              </div>
            </div>
          )}

          {activeSection === 'zkt' && (
            <div className="space-y-5">
              <SectionHead title={t('zkt.title')} description={t('zkt.description')} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('zkt.username')}>
                  <Input
                    autoComplete="username"
                    value={draft.zktAttendance.username}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        zktAttendance: { ...prev.zktAttendance, username: e.target.value },
                      }))
                    }
                    placeholder={t('zkt.usernamePlaceholder')}
                  />
                </Field>
                <Field label={t('zkt.password')}>
                  <Input.Password
                    autoComplete="current-password"
                    value={draft.zktAttendance.password}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        zktAttendance: { ...prev.zktAttendance, password: e.target.value },
                      }))
                    }
                    placeholder={t('zkt.passwordPlaceholder')}
                  />
                </Field>
                <Field className="sm:col-span-2" label={t('zkt.departments')} hint={t('zkt.departmentsHint')}>
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
                </Field>
              </div>
            </div>
          )}

          {activeSection === 'about' && (
            <div className="space-y-4">
              <SectionHead title={t('about.title')} description={t('about.description')} />
              <p className="text-sm leading-6 text-slate-600">{t('about.body')}</p>
              <p className="rounded-lg border border-[#d8e6ee] bg-[#f0f7fb] px-4 py-3 text-sm leading-6 text-slate-600">
                {t('about.offlineNote')}
              </p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
