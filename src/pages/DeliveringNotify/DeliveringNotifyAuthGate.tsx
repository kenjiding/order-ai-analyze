import { useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'
import { deliveringNotifyLoginHref } from '../Login/loginReturnTo'
import DeliveringNotifyPage from './DeliveringNotifyPage'

function redirectToMainLogin() {
  window.location.replace(deliveringNotifyLoginHref())
}

/**
 * 独立入口无 Router：未登录跳主站 /login，登完靠 ?from= 整页跳回本 HTML。
 * 已登录时仍走 authStore，AppSettingsProvider 才能拉 iMile Token。
 */
export function DeliveringNotifyAuthGate() {
  const loading = useAuthStore((s) => s.loading)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const displayName = user?.displayName || user?.username || ''

  useEffect(() => {
    if (!loading && !isAuthenticated) redirectToMainLogin()
  }, [loading, isAuthenticated])

  const handleUnauthorized = () => {
    useAuthStore.setState({
      user: null,
      permissions: [],
      isAuthenticated: false,
      isSuperAdmin: false,
    })
    redirectToMainLogin()
  }

  const handleLogout = async () => {
    await logout()
    redirectToMainLogin()
  }

  if (loading || !isAuthenticated) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-gradient-to-b from-slate-50 via-white to-blue-50/40">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" aria-hidden strokeWidth={2} />
      </div>
    )
  }

  return (
    <DeliveringNotifyPage
      displayName={displayName}
      onUnauthorized={handleUnauthorized}
      onLogout={() => void handleLogout()}
    />
  )
}
