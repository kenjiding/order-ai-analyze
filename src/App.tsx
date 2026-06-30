import { useEffect, type ReactNode } from 'react'
import { App as AntdApp, ConfigProvider } from 'antd'
import { AliveScope, KeepAlive } from 'react-activation'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { antdTheme } from './theme/antdTheme'
import { AppSettingsProvider } from './context/AppSettingsContext'
import AppLayout from './components/AppLayout'
import ProtectedRoute from './components/ProtectedRoute'
import NewMerchantMonitorPage from './pages/NewMerchantMonitor/NewMerchantMonitorPage'
import OrderExceptionManagementPage from './pages/OrderExceptionManagement/OrderExceptionManagementPage'
import ProblemPackageAuditPage from './pages/ProblemPackageAudit/ProblemPackageAuditPage'
import VendorAnalysisPage from './pages/VendorAnalysis/VendorAnalysisPage'
import ScannerEfficiencyPage from './pages/ScannerEfficiency/ScannerEfficiencyPage'
import EfficiencyAttendanceRecordsPage from './pages/EfficiencyAttendanceRecords/EfficiencyAttendanceRecordsPage'
import PushNotificationsPage from './pages/PushNotifications/PushNotificationsPage'
import WageSalaryPage from './pages/WageSalary/WageSalaryPage'
import WarehouseSafetyInspectionPage from './pages/WarehouseSafetyInspection/WarehouseSafetyInspectionPage'
import SystemUsersPage from './pages/SystemUsers/SystemUsersPage'
import LoginPage from './pages/Login/LoginPage'
import VendorSnapshotPage from './pages/VendorAnalysis/VendorSnapshotPage'
import ExitAlarmPage from './pages/ExitAlarm/ExitAlarmPage'
import { getDefaultRouteForPermissions } from './components/Layout/sidebarMenu'
import { useAuthStore } from './stores/authStore'
import { ToastBridge } from './utils/toast'

function AuthBootstrap({ children }: { children: ReactNode }) {
  const refreshMe = useAuthStore((s) => s.refreshMe)
  useEffect(() => { void refreshMe() }, [refreshMe])
  return <>{children}</>
}

const muiTheme = createTheme({
  palette: {
    primary: { main: '#1f6f68' },
  },
  components: {
    MuiTab: {
      styleOverrides: {
        root: { textTransform: 'none', fontWeight: 600, fontSize: '0.875rem' },
      },
    },
  },
})

function KeptScannerEfficiencyPage() {
  return (
    <KeepAlive
      cacheKey="page-scanner-efficiency"
      name="scanner-efficiency"
      autoFreeze={false}
    >
      <ScannerEfficiencyPage />
    </KeepAlive>
  )
}

function KeptWageSalaryPage() {
  return (
    <KeepAlive cacheKey="page-wage-salary" name="wage-salary" autoFreeze={false}>
      <WageSalaryPage />
    </KeepAlive>
  )
}

function KeptOrderExceptionPage() {
  return (
    <KeepAlive cacheKey="page-order-exception" name="order-exception" autoFreeze={false}>
      <OrderExceptionManagementPage />
    </KeepAlive>
  )
}

function KeptNewMerchantMonitorPage() {
  return (
    <KeepAlive cacheKey="page-new-merchant-monitor" name="new-merchant-monitor" autoFreeze={false}>
      <NewMerchantMonitorPage />
    </KeepAlive>
  )
}

function KeptProblemPackageAuditPage() {
  return (
    <KeepAlive cacheKey="page-problem-package-audit" name="problem-package-audit" autoFreeze={false}>
      <ProblemPackageAuditPage />
    </KeepAlive>
  )
}

function KeptPushNotificationsPage() {
  return (
    <KeepAlive cacheKey="page-push-notifications" name="push-notifications" autoFreeze={false}>
      <PushNotificationsPage />
    </KeepAlive>
  )
}

function KeptWarehouseSafetyInspectionPage() {
  return (
    <KeepAlive cacheKey="page-warehouse-safety" name="warehouse-safety" autoFreeze={false}>
      <WarehouseSafetyInspectionPage />
    </KeepAlive>
  )
}

function KeptSystemUsersPage() {
  return (
    <KeepAlive cacheKey="page-system-users" name="system-users" autoFreeze={false}>
      <SystemUsersPage />
    </KeepAlive>
  )
}

function KeptExitAlarmPage() {
  return (
    <KeepAlive cacheKey="page-exit-alarm" name="exit-alarm" autoFreeze={false}>
      <ExitAlarmPage />
    </KeepAlive>
  )
}

function KeptVendorAnalysisPage() {
  return (
    <KeepAlive cacheKey="page-vendor-analysis" name="vendor-analysis" autoFreeze={false}>
      <VendorAnalysisPage />
    </KeepAlive>
  )
}

function AuthenticatedShell() {
  return (
    <AliveScope>
      <AppLayout />
    </AliveScope>
  )
}

function DefaultHomeRedirect() {
  const { hasPermission, isSuperAdmin, loading, isAuthenticated } = useAuthStore()
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-600">
        正在验证登录状态…
      </div>
    )
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }
  return <Navigate to={getDefaultRouteForPermissions(hasPermission, isSuperAdmin)} replace />
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/vendor-snapshot" element={<VendorSnapshotPage />} />
        <Route element={<AuthenticatedShell />}>
          <Route path="/" element={<DefaultHomeRedirect />} />
          <Route path="/efficiency" element={<KeptScannerEfficiencyPage />} />
          <Route path="/efficiency-records" element={<EfficiencyAttendanceRecordsPage />} />
          <Route path="/wage-salary" element={<KeptWageSalaryPage />} />
          <Route path="/order-exception" element={<KeptOrderExceptionPage />} />
          <Route path="/new-merchant-monitor" element={<KeptNewMerchantMonitorPage />} />
          <Route path="/problem-package-audit" element={<KeptProblemPackageAuditPage />} />
          <Route path="/vendor-analysis" element={<KeptVendorAnalysisPage />} />
          <Route path="/exit-alarm" element={<KeptExitAlarmPage />} />
          <Route path="/push-notifications" element={<KeptPushNotificationsPage />} />
          <Route path="/warehouse-safety" element={<KeptWarehouseSafetyInspectionPage />} />
          <Route path="/system/users" element={<KeptSystemUsersPage />} />
        </Route>
      </Route>
      <Route path="*" element={<DefaultHomeRedirect />} />
    </Routes>
  )
}

export default function App() {
  return (
    <ConfigProvider theme={antdTheme}>
      <AntdApp>
        <ToastBridge />
        <ThemeProvider theme={muiTheme}>
          <AuthBootstrap>
            <AppSettingsProvider>
              <BrowserRouter>
                <AppRoutes />
              </BrowserRouter>
            </AppSettingsProvider>
          </AuthBootstrap>
        </ThemeProvider>
      </AntdApp>
    </ConfigProvider>
  )
}
