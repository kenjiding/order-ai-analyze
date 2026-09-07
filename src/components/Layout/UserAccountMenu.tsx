import { useMemo, useState, type ReactNode } from 'react'
import { Dropdown } from 'antd'
import { ChevronDown, LogOut, MapPin, Settings, Shield, User } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import type { AuthUser } from '../../api/authApi'
import { useAuthStore } from '../../stores/authStore'
import { GlobalSettingsModal } from '../AppSettings/GlobalSettingsModal'

function getInitials(user: AuthUser | null): string {
  const source = user?.displayName?.trim() || user?.username?.trim() || '?'
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase()
  }
  return source.slice(0, 2).toUpperCase()
}

function getRoleLabel(role: AuthUser['role'], t: (key: string) => string): string {
  return role === 'super_admin' ? t('superAdmin') : t('regularUser')
}

function getAccountSubtitle(user: AuthUser | null, t: (key: string) => string): string {
  if (!user) return '—'
  return user.regionName?.trim() || getRoleLabel(user.role, t)
}

type MetaRowProps = {
  icon: ReactNode
  label: string
  value: string
}

function MetaRow({ icon, label, value }: MetaRowProps) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-slate-50 text-slate-500">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-medium uppercase tracking-[0.1em] text-slate-400">{label}</div>
        <div className="truncate text-xs text-slate-800">{value}</div>
      </div>
    </div>
  )
}

type MenuActionProps = {
  icon: ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  tone?: 'default' | 'danger'
}

function MenuAction({ icon, label, onClick, disabled, tone = 'default' }: MenuActionProps) {
  const toneClass =
    tone === 'danger'
      ? 'text-slate-700 hover:bg-red-50 hover:text-red-700 disabled:hover:bg-transparent disabled:hover:text-slate-700'
      : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900 disabled:hover:bg-transparent disabled:hover:text-slate-700'
  const iconToneClass =
    tone === 'danger'
      ? 'bg-slate-50 text-slate-500 group-hover:bg-red-100 group-hover:text-red-600'
      : 'bg-slate-50 text-slate-500 group-hover:bg-[var(--admin-accent-soft)] group-hover:text-[var(--admin-accent)]'

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`group flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${toneClass}`}
    >
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded transition ${iconToneClass}`}>
        {icon}
      </span>
      {label}
    </button>
  )
}

export default function UserAccountMenu() {
  const { t } = useTranslation('common')
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()
  const [open, setOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const displayName = user?.displayName?.trim() || user?.username || t('loggedIn')
  const initials = useMemo(() => getInitials(user), [user])

  const handleLogout = async () => {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await logout()
      navigate('/login', { replace: true })
    } finally {
      setLoggingOut(false)
      setOpen(false)
    }
  }

  const dropdownContent = (
    <div className="w-[min(15.5rem,calc(100vw-2rem))] overflow-hidden rounded-md border border-[var(--admin-line)] bg-white shadow-[0_10px_28px_rgba(47,83,105,0.1)]">
      <div className="border-b border-[var(--admin-line)] bg-[var(--admin-surface-soft)] px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--admin-accent-soft)] text-xs font-semibold text-[var(--admin-accent)]">
            {initials}
            <span
              className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-white bg-[var(--admin-accent)]"
              aria-hidden
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-slate-950">{displayName}</div>
            <div className="truncate text-[11px] leading-tight text-slate-500">@{user?.username ?? '—'}</div>
          </div>
        </div>
      </div>

      <div className="px-3 py-1.5">
        <MetaRow icon={<User className="h-3 w-3" aria-hidden />} label={t('account')} value={user?.username ?? '—'} />
        {user?.role ? (
          <MetaRow
            icon={<Shield className="h-3 w-3" aria-hidden />}
            label={t('role')}
            value={getRoleLabel(user.role, t)}
          />
        ) : null}
        {user?.regionName ? (
          <MetaRow
            icon={<MapPin className="h-3 w-3" aria-hidden />}
            label={t('region')}
            value={user.regionName}
          />
        ) : null}
      </div>

      <div className="border-t border-[var(--admin-line)] p-1">
        <MenuAction
          icon={<Settings className="h-3.5 w-3.5" aria-hidden />}
          label={t('systemSettings')}
          onClick={() => {
            setOpen(false)
            setSettingsOpen(true)
          }}
        />
        <MenuAction
          icon={<LogOut className="h-3.5 w-3.5" aria-hidden />}
          label={loggingOut ? t('loggingOut') : t('logout')}
          disabled={loggingOut}
          tone="danger"
          onClick={() => {
            void handleLogout()
          }}
        />
      </div>
    </div>
  )

  return (
    <>
      <Dropdown
        open={open}
        onOpenChange={setOpen}
        trigger={['click']}
        placement="bottomRight"
        styles={{ root: { padding: 0, boxShadow: 'none', background: 'transparent' } }}
        popupRender={() => dropdownContent}
      >
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          className={[
            'inline-flex max-w-[min(14rem,calc(100vw-5rem))] items-center gap-1.5 rounded-md bg-white px-1.5 py-1 text-left transition',
            open
              ? 'bg-slate-50 shadow-[0_4px_14px_rgba(47,83,105,0.12)]'
              : 'hover:bg-slate-50 hover:shadow-[0_4px_14px_rgba(47,83,105,0.12)]',
          ].join(' ')}
        >
          <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--admin-accent-soft)] text-[11px] font-semibold text-[var(--admin-accent)]">
            {initials}
            <span
              className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-white bg-[var(--admin-accent)]"
              aria-hidden
            />
          </span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-xs font-semibold text-slate-900">{displayName}</span>
            <span className="block truncate text-[10px] text-slate-500">
              {getAccountSubtitle(user, t)}
            </span>
          </span>
          <ChevronDown
            className={['h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform', open ? 'rotate-180' : ''].join(' ')}
            aria-hidden
          />
        </button>
      </Dropdown>
      <GlobalSettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  )
}
