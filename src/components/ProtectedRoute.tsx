import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { getDefaultRouteForPermissions, getMenuPermissionForPath } from '../components/Layout/sidebarMenu'

export default function ProtectedRoute() {
  const { loading, isAuthenticated, hasPermission, isSuperAdmin } = useAuthStore()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-600">
        正在验证登录状态…
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  const requiredPermission = getMenuPermissionForPath(location.pathname)
  if (requiredPermission && !hasPermission(requiredPermission) && !isSuperAdmin) {
    const fallback = getDefaultRouteForPermissions(hasPermission, isSuperAdmin)
    return <Navigate to={fallback} replace />
  }

  return <Outlet />
}
