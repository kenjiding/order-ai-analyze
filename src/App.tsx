import { App as AntdApp, ConfigProvider } from 'antd'
import { AuthProvider } from './context/AuthContext'
import { AliveScope, KeepAlive } from 'react-activation'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { antdTheme } from './theme/antdTheme'
import { AppSettingsProvider } from './context/AppSettingsContext'
import AppLayout from './components/AppLayout'
import ProtectedRoute from './components/ProtectedRoute'
import OrderExceptionManagementPage from './pages/OrderExceptionManagement/OrderExceptionManagementPage'
import ScannerEfficiencyPage from './pages/ScannerEfficiency/ScannerEfficiencyPage'
import PushNotificationsPage from './pages/PushNotifications/PushNotificationsPage'
import WageSalaryPage from './pages/WageSalary/WageSalaryPage'
import WarehouseSafetyInspectionPage from './pages/WarehouseSafetyInspection/WarehouseSafetyInspectionPage'
import SystemUsersPage from './pages/SystemUsers/SystemUsersPage'
import LoginPage from './pages/Login/LoginPage'
import { getDefaultRouteForPermissions } from './components/Layout/sidebarMenu'
import { useAuth } from './context/AuthContext'

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

function DefaultHomeRedirect() {
  const { hasPermission, isSuperAdmin, loading } = useAuth()
  if (loading) return null
  return <Navigate to={getDefaultRouteForPermissions(hasPermission, isSuperAdmin)} replace />
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<DefaultHomeRedirect />} />
          <Route path="/efficiency" element={<KeptScannerEfficiencyPage />} />
          <Route path="/wage-salary" element={<KeptWageSalaryPage />} />
          <Route path="/order-exception" element={<KeptOrderExceptionPage />} />
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
        <ThemeProvider theme={muiTheme}>
          <AuthProvider>
            <AppSettingsProvider>
              <BrowserRouter>
                <AliveScope>
                  <AppRoutes />
                </AliveScope>
              </BrowserRouter>
            </AppSettingsProvider>
          </AuthProvider>
        </ThemeProvider>
      </AntdApp>
    </ConfigProvider>
  )
}
