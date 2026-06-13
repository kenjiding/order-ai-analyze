import { type FormEvent, useEffect, useState } from 'react'
import { Warehouse } from 'lucide-react'
import { useLoginRive } from './useLoginRive'
import './login.css'

const REMEMBER_KEY = 'rememberMe'
const EMAIL_KEY = 'email'

export default function LoginPage() {
  const {
    riveCanvasRef,
    eyeCanvasRef,
    emailRef,
    passwordRef,
    handleEmailFocus,
    handleEmailInput,
    handleEmailBlur,
    handlePasswordFocus,
    handlePasswordBlur,
    togglePasswordVisibility,
    fireWrongTrigger,
    validateEmailFormat,
  } = useLoginRive()

  const [remember, setRemember] = useState(false)
  const [passwordError, setPasswordError] = useState(false)
  const [passwordShake, setPasswordShake] = useState(false)

  useEffect(() => {
    if (localStorage.getItem(REMEMBER_KEY) === 'true') {
      const savedEmail = localStorage.getItem(EMAIL_KEY)
      if (savedEmail && emailRef.current) {
        emailRef.current.value = savedEmail
        setRemember(true)
      }
    }
  }, [emailRef])

  const triggerPasswordError = () => {
    setPasswordError(true)
    setPasswordShake(false)
    requestAnimationFrame(() => {
      setPasswordShake(true)
    })
    fireWrongTrigger()
  }

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    const email = emailRef.current?.value.trim() ?? ''
    const password = passwordRef.current?.value ?? ''
    const isEmailValid = validateEmailFormat(email)

    if (!email || !isEmailValid) {
      fireWrongTrigger()
      alert('请输入有效的企业邮箱，例如 name@company.com')
      return
    }

    if (!password) {
      fireWrongTrigger()
      alert('请输入密码')
      return
    }

    triggerPasswordError()
  }

  const handlePasswordInput = () => {
    if (passwordError) {
      setPasswordError(false)
      setPasswordShake(false)
    }
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
            <canvas
              ref={riveCanvasRef}
              className="login-illustration__canvas"
              width={900}
              height={800}
            />
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
            <header className="mb-8">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]">
                  <Warehouse className="h-6 w-6" aria-hidden />
                </div>
                <div>
                  <h1 className="text-[15px] font-semibold tracking-tight text-slate-900">物流运营效率管理</h1>
                  <p className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.22em] text-slate-500">
                    Warehouse Control
                  </p>
                </div>
              </div>
            </header>

            <div className="admin-panel overflow-hidden">
              <div className="border-b px-5 py-4" style={{ borderColor: 'var(--admin-line)' }}>
                <p className="text-sm font-medium text-slate-800">账号验证</p>
                <p className="mt-0.5 text-xs text-slate-500">登录后可访问效率分析、工资与异常管理模块</p>
              </div>

              <form className="space-y-4 px-5 py-5" onSubmit={handleSubmit}>
                <div>
                  <label htmlFor="email" className="login-field-label mb-1.5 block text-xs font-semibold text-slate-600">
                    企业邮箱
                  </label>
                  <input
                    ref={emailRef}
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="name@company.com"
                    required
                    className="login-field-input"
                    onFocus={handleEmailFocus}
                    onInput={handleEmailInput}
                    onBlur={handleEmailBlur}
                  />
                </div>

                <div>
                  <label
                    htmlFor="password"
                    className="login-field-label mb-1.5 block text-xs font-semibold text-slate-600"
                  >
                    密码
                  </label>
                  <div
                    className={[
                      'login-password-wrap',
                      passwordError ? 'error' : '',
                      passwordShake ? 'login-shake' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <input
                      ref={passwordRef}
                      id="password"
                      type="password"
                      autoComplete="current-password"
                      placeholder="请输入密码"
                      required
                      className="login-field-input"
                      onFocus={handlePasswordFocus}
                      onBlur={handlePasswordBlur}
                      onInput={handlePasswordInput}
                    />
                    <button
                      type="button"
                      className="login-toggle-password"
                      aria-label="切换密码可见性"
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
                    记住登录 30 天
                  </label>
                  <a
                    href="#"
                    className="text-xs font-medium text-[#1f6f68] transition hover:text-[var(--admin-accent)]"
                    onClick={(e) => e.preventDefault()}
                  >
                    忘记密码
                  </a>
                </div>

                <button type="submit" className="admin-btn admin-btn-primary mt-2 w-full py-2.5">
                  进入控制台
                </button>
              </form>
            </div>

            <div className="mt-6 flex items-center justify-center gap-2 text-xs text-slate-500">
              <span className="h-2 w-2 rounded-full bg-[var(--admin-accent)]" aria-hidden />
              离线计算 · 本机存储
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
