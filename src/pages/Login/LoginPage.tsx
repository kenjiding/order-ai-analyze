import { type FormEvent, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Warehouse } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../../stores/authStore'
import { useAppSettings } from '../../context/AppSettingsContext'
import { getDefaultRouteForPermissions, getDefaultRouteFromPermissionKeys } from '../../components/Layout/sidebarMenu'
import { showToast } from '../../utils/toast'
import { useLoginRive } from './useLoginRive'
import { leaveLoginTo, readSafeLoginReturnTo } from './loginReturnTo'
import { LocaleSwitcher } from '../../components/I18n/LocaleSwitcher'
import './login.css'

const REMEMBER_KEY = 'rememberMe'
const USERNAME_KEY = 'username'

export default function LoginPage() {
  const { t } = useTranslation('login')
  const { t: tm } = useTranslation('menu')
  const navigate = useNavigate()
  const location = useLocation()
  const { login, isAuthenticated, loading, hasPermission, isSuperAdmin } = useAuthStore()
  const { refreshSettings } = useAppSettings()
  const [submitting, setSubmitting] = useState(false)
  const {
    riveCanvasRef,
    eyeCanvasRef,
    emailRef: usernameRef,
    passwordRef,
    handleEmailFocus: handleUsernameFocus,
    handleEmailInput: handleUsernameInput,
    handleEmailBlur: handleUsernameBlur,
    handlePasswordFocus,
    handlePasswordBlur,
    togglePasswordVisibility,
    fireWrongTrigger,
  } = useLoginRive()

  const [remember, setRemember] = useState(false)
  const [passwordError, setPasswordError] = useState(false)
  const [passwordShake, setPasswordShake] = useState(false)

  useEffect(() => {
    if (loading || !isAuthenticated) return
    const from = readSafeLoginReturnTo(location.search, (location.state as { from?: string } | null)?.from)
    const target = from || getDefaultRouteForPermissions(hasPermission, isSuperAdmin)
    if (target === '/login') return
    leaveLoginTo(target, navigate)
  }, [loading, isAuthenticated, navigate, hasPermission, isSuperAdmin, location.search, location.state])

  useEffect(() => {
    if (localStorage.getItem(REMEMBER_KEY) === 'true') {
      const savedUsername = localStorage.getItem(USERNAME_KEY)
      if (savedUsername && usernameRef.current) {
        usernameRef.current.value = savedUsername
        setRemember(true)
      }
    }
  }, [usernameRef])

  const triggerPasswordError = (message?: string) => {
    if (message) showToast(message, 'error')
    setPasswordError(true)
    setPasswordShake(false)
    requestAnimationFrame(() => {
      setPasswordShake(true)
    })
    fireWrongTrigger()
  }

  const clearPasswordError = () => {
    setPasswordError(false)
    setPasswordShake(false)
  }

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    const username = usernameRef.current?.value.trim() ?? ''
    const password = passwordRef.current?.value ?? ''

    if (!username) {
      triggerPasswordError(t('usernameRequired'))
      return
    }

    if (!password) {
      triggerPasswordError(t('passwordRequired'))
      return
    }

    setSubmitting(true)
    void login(username, password)
      .then((session) => {
        clearPasswordError()
        void refreshSettings()
        if (remember) {
          localStorage.setItem(REMEMBER_KEY, 'true')
          localStorage.setItem(USERNAME_KEY, username)
        } else {
          localStorage.removeItem(REMEMBER_KEY)
          localStorage.removeItem(USERNAME_KEY)
        }
        const from = readSafeLoginReturnTo(
          location.search,
          (location.state as { from?: string } | null)?.from,
        )
        const defaultRoute = getDefaultRouteFromPermissionKeys(
          session.permissions,
          session.user.role === 'super_admin',
        )
        const target = from || defaultRoute
        if (target === '/login') {
          triggerPasswordError(t('noPagesAssigned'))
          return
        }
        leaveLoginTo(target, navigate)
      })
      .catch((e: unknown) => {
        const message = e instanceof Error ? e.message : t('loginFailed')
        triggerPasswordError(message)
      })
      .finally(() => {
        setSubmitting(false)
      })
  }

  const handlePasswordInput = () => {
    if (passwordError) clearPasswordError()
  }

  const handleUsernameInputWithClear = () => {
    handleUsernameInput()
    if (passwordError) clearPasswordError()
  }

  const handleTogglePasswordMouseDown = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
  }

  return (
    <div className="login-page relative overflow-hidden">
      <div className="login-page__backdrop" aria-hidden>
        <div className="login-orb login-orb--teal" />
        <div className="login-orb login-orb--sky" />
        <div className="login-orb login-orb--mint" />
        <div className="login-flow-lines" />
        <div className="login-dot-field" />
      </div>

      <div className="relative z-10 flex min-h-screen w-full">
        <section className="login-illustration hidden lg:flex lg:flex-col" aria-hidden>
          <div className="login-illustration__accents" aria-hidden>
            <span className="login-accent-dot login-accent-dot--a" />
            <span className="login-accent-dot login-accent-dot--b" />
            <span className="login-accent-dot login-accent-dot--c" />
            <span className="login-accent-ring login-accent-ring--a" />
            <span className="login-accent-ring login-accent-ring--b" />
          </div>

          <div className="login-illustration__stage min-h-0 flex-1">
            <div className="login-frame login-frame--tl" />
            <div className="login-frame login-frame--tr" />
            <div className="login-frame login-frame--bl" />
            <div className="login-frame login-frame--br" />
            <canvas ref={riveCanvasRef} className="login-illustration__canvas" width={900} height={800} />
            <div className="login-illustration__tint" aria-hidden />
            <div className="login-illustration__grid" aria-hidden />
          </div>
        </section>

        <section className="login-form-panel flex-1">
          <div className="login-form-deco" aria-hidden>
            <div className="login-form-ring" />
            <span className="login-accent-blob login-accent-blob--a" />
            <span className="login-accent-blob login-accent-blob--b" />
            <span className="login-accent-arc login-accent-arc--a" />
            <span className="login-accent-arc login-accent-arc--b" />
          </div>

          <div className="login-form-card relative z-[1]">
            <div className="mb-4 flex justify-end">
              <LocaleSwitcher toolbar />
            </div>
            <header className="mb-8">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]">
                  <Warehouse className="h-6 w-6" aria-hidden />
                </div>
                <div>
                  <h1 className="text-[15px] font-semibold tracking-tight text-slate-900">{tm('brandTitle')}</h1>
                  <p className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.22em] text-slate-500">
                    {tm('brandSubtitle')}
                  </p>
                </div>
              </div>
            </header>

            <div className="admin-panel overflow-hidden">
              <div className="border-b px-5 py-4" style={{ borderColor: 'var(--admin-line)' }}>
                <p className="text-sm font-medium text-slate-800">{t('title')}</p>
                <p className="mt-0.5 text-xs text-slate-500">{t('subtitle')}</p>
              </div>

              <form className="space-y-4 px-5 py-5" onSubmit={handleSubmit}>
                <div>
                  <label htmlFor="username" className="login-field-label mb-1.5 block text-xs font-semibold text-slate-600">
                    {t('username')}
                  </label>
                  <input
                    ref={usernameRef}
                    id="username"
                    type="text"
                    autoComplete="username"
                    placeholder={t('usernamePlaceholder')}
                    required
                    className="login-field-input"
                    onFocus={handleUsernameFocus}
                    onInput={handleUsernameInputWithClear}
                    onBlur={handleUsernameBlur}
                  />
                </div>

                <div>
                  <label htmlFor="password" className="login-field-label mb-1.5 block text-xs font-semibold text-slate-600">
                    {t('password')}
                  </label>
                  <div
                    className={['login-password-wrap', passwordError ? 'error' : '', passwordShake ? 'login-shake' : '']
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <input
                      ref={passwordRef}
                      id="password"
                      type="password"
                      autoComplete="current-password"
                      placeholder={t('passwordPlaceholder')}
                      required
                      className="login-field-input"
                      onFocus={handlePasswordFocus}
                      onBlur={handlePasswordBlur}
                      onInput={handlePasswordInput}
                    />
                    <button
                      type="button"
                      className="login-toggle-password"
                      aria-label={t('togglePassword')}
                      onMouseDown={handleTogglePasswordMouseDown}
                      onClick={togglePasswordVisibility}
                    >
                      <canvas ref={eyeCanvasRef} width={24} height={24} className="login-eye-icon" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 pt-1">
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      className="login-checkbox"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                    />
                    {t('remember')}
                  </label>
                  <a
                    href="#"
                    className="text-xs font-medium text-[#1f6f68] transition hover:text-[var(--admin-accent)]"
                    onClick={(e) => e.preventDefault()}
                  >
                    {t('forgotPassword')}
                  </a>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="admin-btn admin-btn-primary mt-2 w-full py-2.5 disabled:opacity-60"
                >
                  {submitting ? t('submitting') : t('submit')}
                </button>
              </form>
            </div>

            <div className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-500">
              <span className="h-2 w-2 rounded-full bg-[var(--admin-accent)]" aria-hidden />
              {t('footer')}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
