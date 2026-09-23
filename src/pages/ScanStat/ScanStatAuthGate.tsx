import { useEffect } from 'react'
import { Button } from 'antd'
import { Loader2 } from 'lucide-react'
import { PERMISSION_KEYS } from '../../hooks/usePermission'
import { useAuthStore } from '../../stores/authStore'
import { scanStatLoginHref } from '../Login/loginReturnTo'
import ScanStatPage from './ScanStatPage'

function redirectToMainLogin() {
  window.location.replace(scanStatLoginHref())
}

export function ScanStatAuthGate() {
  const loading = useAuthStore((s) => s.loading)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const user = useAuthStore((s) => s.user)
  const hasPermission = useAuthStore((s) => s.hasPermission)
  const logout = useAuthStore((s) => s.logout)
  const displayName = user?.displayName || user?.username || ''
  const allowed = hasPermission(PERMISSION_KEYS.menuScanStat)

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

  if (!allowed) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-3 bg-slate-50 px-6 text-center">
        <p className="text-sm text-zinc-700">当前账号没有「扫描统计」权限</p>
        <Button onClick={() => void handleLogout()}>退出登录</Button>
      </div>
    )
  }

  return (
    <ScanStatPage
      displayName={displayName}
      onUnauthorized={handleUnauthorized}
      onLogout={() => void handleLogout()}
    />
  )
}
