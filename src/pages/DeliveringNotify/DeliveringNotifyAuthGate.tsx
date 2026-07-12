import { useEffect, useState } from 'react'
import { Button, Field, Form } from 'react-vant'
import 'react-vant/es/form/style/index.css'
import 'react-vant/es/field/style/index.css'
import 'react-vant/es/button/style/index.css'
import { BellRing, CircleX, Eye, EyeOff, KeyRound, Loader2, User } from 'lucide-react'
import { fetchAuthMe, fetchLogin, fetchLogout } from '../../api/authApi'
import { useAppSettings } from '../../context/AppSettingsContext'
import DeliveringNotifyPage from './DeliveringNotifyPage'

type GateStatus = 'checking' | 'anon' | 'authed'

/**
 * 独立入口页脱离主 SPA 的 Router/authStore，PDA 浏览器可能从未登录过主站，
 * 因此在这里自行做一次最小化的登录态检查与登录表单，登录成功后 cookie 与主站共享。
 */
export function DeliveringNotifyAuthGate() {
  const { refreshSettings } = useAppSettings()
  const [status, setStatus] = useState<GateStatus>('checking')
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loginError, setLoginError] = useState('')
  const [loggingIn, setLoggingIn] = useState(false)

  useEffect(() => {
    void fetchAuthMe()
      .then((session) => {
        if (session) {
          setDisplayName(session.user.displayName || session.user.username)
          setStatus('authed')
        } else {
          setStatus('anon')
        }
      })
      .catch(() => setStatus('anon'))
  }, [])

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      setLoginError('请输入用户名和密码')
      return
    }
    setLoggingIn(true)
    setLoginError('')
    try {
      const session = await fetchLogin(username.trim(), password)
      setDisplayName(session.user.displayName || session.user.username)
      setPassword('')
      setStatus('authed')
      void refreshSettings()
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setLoggingIn(false)
    }
  }

  const handleLogout = async () => {
    await fetchLogout()
    setStatus('anon')
  }

  if (status === 'checking') {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-gradient-to-b from-slate-50 via-white to-blue-50/40">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" aria-hidden strokeWidth={2} />
      </div>
    )
  }

  if (status === 'anon') {
    return (
      <div className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden bg-gradient-to-b from-slate-50 via-white to-blue-50/40 px-3">
        <div
          className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-blue-400/20 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -left-20 bottom-10 h-56 w-56 rounded-full bg-indigo-400/10 blur-3xl"
          aria-hidden
        />
        <div className="relative z-10 w-full max-w-sm overflow-hidden rounded-2xl border border-zinc-200 bg-white/95 shadow-xl shadow-blue-900/10 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-1.5 px-4 pb-2 pt-5 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 shadow-sm shadow-blue-600/30">
              <BellRing className="h-5 w-5 text-white" aria-hidden strokeWidth={2} />
            </span>
            <h1 className="text-base font-semibold text-zinc-900">登录后继续</h1>
            <p className="text-xs text-zinc-500">派送中包裹通知</p>
          </div>

          <Form onFinish={() => void handleLogin()}>
            <Field
              label={<User className="h-4 w-4 text-zinc-400" aria-hidden strokeWidth={2} />}
              name="username"
              placeholder="用户名"
              value={username}
              onChange={setUsername}
              autoFocus
            />
            <Field
              label={<KeyRound className="h-4 w-4 text-zinc-400" aria-hidden strokeWidth={2} />}
              name="password"
              type={showPassword ? 'text' : 'password'}
              placeholder="密码"
              value={password}
              onChange={setPassword}
              rightIcon={
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? '隐藏密码' : '显示密码'}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4 text-zinc-400" aria-hidden strokeWidth={2} />
                  ) : (
                    <Eye className="h-4 w-4 text-zinc-400" aria-hidden strokeWidth={2} />
                  )}
                </button>
              }
            />
          </Form>

          {loginError && (
            <div className="mx-4 mb-2 flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
              <CircleX className="h-3.5 w-3.5 shrink-0" aria-hidden strokeWidth={2} />
              {loginError}
            </div>
          )}

          <div className="p-4 pt-2">
            <Button
              type="primary"
              block
              loading={loggingIn}
              onClick={() => void handleLogin()}
            >
              登录
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <DeliveringNotifyPage
      displayName={displayName}
      onUnauthorized={() => setStatus('anon')}
      onLogout={() => void handleLogout()}
    />
  )
}
