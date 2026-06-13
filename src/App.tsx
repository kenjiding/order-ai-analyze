import { AliveScope, KeepAlive } from 'react-activation'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppSettingsProvider } from './context/AppSettingsContext'
import AppLayout from './components/AppLayout'
import OrderExceptionManagementPage from './pages/OrderExceptionManagement/OrderExceptionManagementPage'
import ScannerEfficiencyPage from './pages/ScannerEfficiency/ScannerEfficiencyPage'
import PushNotificationsPage from './pages/PushNotifications/PushNotificationsPage'
import WageSalaryPage from './pages/WageSalary/WageSalaryPage'
import WarehouseSafetyInspectionPage from './pages/WarehouseSafetyInspection/WarehouseSafetyInspectionPage'
import LoginPage from './pages/Login/LoginPage'

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
      // 与 React 18 createRoot 兼容；见 react-activation README
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

export default function App() {
  return (
    <ThemeProvider theme={muiTheme}>
      <AppSettingsProvider>
        <BrowserRouter>
          <AliveScope>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<AppLayout />}>
                <Route path="/" element={<Navigate to="/efficiency" replace />} />
                <Route path="/efficiency" element={<KeptScannerEfficiencyPage />} />
                <Route path="/wage-salary" element={<KeptWageSalaryPage />} />
                <Route path="/order-exception" element={<KeptOrderExceptionPage />} />
                <Route path="/push-notifications" element={<KeptPushNotificationsPage />} />
                <Route path="/warehouse-safety" element={<KeptWarehouseSafetyInspectionPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/efficiency" replace />} />
            </Routes>
          </AliveScope>
        </BrowserRouter>
      </AppSettingsProvider>
    </ThemeProvider>
  )
}
