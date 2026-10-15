import { lazy, Suspense, useEffect, type ReactNode } from 'react'
import { App as AntdApp, ConfigProvider, Spin } from 'antd'
import enUS from 'antd/locale/en_US'
import zhCN from 'antd/locale/zh_CN'
import { AliveScope, KeepAlive } from 'react-activation'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import { useTranslation } from 'react-i18next'
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { antdTheme } from './theme/antdTheme'
import { AppSettingsProvider } from './context/AppSettingsContext'
import { I18nProvider } from './i18n/I18nProvider'
import AppLayout from './components/AppLayout'
import ProtectedRoute from './components/ProtectedRoute'
import { getDefaultRouteForPermissions } from './components/Layout/sidebarMenu'
import { useAuthStore } from './stores/authStore'
import { ToastBridge } from './utils/toast'

// 各页面按路由懒加载，避免所有页面的代码被打进同一个入口 chunk
const NewMerchantMonitorPage = lazy(() => import('./pages/NewMerchantMonitor/NewMerchantMonitorPage'))
const OrderExceptionManagementPage = lazy(() => import('./pages/OrderExceptionManagement/OrderExceptionManagementPage'))
const AddressVerifyPage = lazy(() => import('./pages/AddressVerify/AddressVerifyPage'))
const ProblemPackageAuditPage = lazy(() => import('./pages/ProblemPackageAudit/ProblemPackageAuditPage'))
const ReturnToMerchantFinishPage = lazy(
  () => import('./pages/ReturnToMerchantFinish/ReturnToMerchantFinishPage'),
)
const VendorAnalysisPage = lazy(() => import('./pages/VendorAnalysis/VendorAnalysisPage'))
const ScannerEfficiencyPage = lazy(() => import('./pages/ScannerEfficiency/ScannerEfficiencyPage'))
const EfficiencyAttendanceRecordsPage = lazy(
  () => import('./pages/EfficiencyAttendanceRecords/EfficiencyAttendanceRecordsPage'),
)
const PushNotificationsPage = lazy(() => import('./pages/PushNotifications/PushNotificationsPage'))
const FleetSupplierPushPage = lazy(() => import('./pages/PushNotifications/FleetSupplierPushPage'))
const WageSalaryPage = lazy(() => import('./pages/WageSalary/WageSalaryPage'))
const WarehouseSafetyInspectionPage = lazy(
  () => import('./pages/WarehouseSafetyInspection/WarehouseSafetyInspectionPage'),
)
const SystemUsersPage = lazy(() => import('./pages/SystemUsers/SystemUsersPage'))
const SupplierConfigPage = lazy(() => import('./pages/SupplierConfig/SupplierConfigPage'))
const RegionPackagePricePage = lazy(() => import('./pages/RegionPackagePrice/RegionPackagePricePage'))
const WarehouseSettingsPage = lazy(() => import('./pages/WarehouseSettings/WarehouseSettingsPage'))
const PriorityClientsPage = lazy(() => import('./pages/PriorityClients/PriorityClientsPage'))
const RegionCalendarPage = lazy(() => import('./pages/RegionCalendar/RegionCalendarPage'))
const LoginPage = lazy(() => import('./pages/Login/LoginPage'))
const VendorSnapshotPage = lazy(() => import('./pages/VendorAnalysis/VendorSnapshotPage'))
const VendorPortalPage = lazy(() => import('./pages/VendorPortal/VendorPortalPage'))
const ChaseDispatchSharePage = lazy(() => import('./pages/ChaseDispatchShare/ChaseDispatchSharePage'))
const ExitAlarmPage = lazy(() => import('./pages/ExitAlarm/ExitAlarmPage'))
const DispatchAlarmPage = lazy(() => import('./pages/DispatchAlarm/DispatchAlarmPage'))
const DispatchPerformancePage = lazy(
  () => import('./pages/DispatchPerformance/DispatchPerformancePage'),
)
const DispatchPerformanceDetailPage = lazy(
  () => import('./pages/DispatchPerformance/DispatchPerformanceDetailPage'),
)
const ExitRateQueryPage = lazy(() => import('./pages/ExitRateQuery/ExitRateQueryPage'))
const ChaseDispatchPage = lazy(() => import('./pages/ChaseDispatch/ChaseDispatchPage'))
const WorkOrderPushPage = lazy(() => import('./pages/WorkOrderPush/WorkOrderPushPage'))
const AttendanceWorkTimePage = lazy(() => import('./pages/AttendanceWorkTime/AttendanceWorkTimePage'))
const ContainerLedgerPage = lazy(() => import('./pages/ContainerLedger/ContainerLedgerPage'))
const ContainerAccountsPage = lazy(() => import('./pages/ContainerAccounts/ContainerAccountsPage'))
const ContainerTransfersPage = lazy(() => import('./pages/ContainerTransfers/ContainerTransfersPage'))
const PushEngagementMonitorPage = lazy(() => import('./pages/PushEngagementMonitor/PushEngagementMonitorPage'))
const PackageLossMonitorPage = lazy(() => import('./pages/PackageLossMonitor/PackageLossMonitorPage'))
const VendorRegionMapPage = lazy(() => import('./pages/VendorRegionMap/VendorRegionMapPage'))

function RouteLoadingFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <Spin />
    </div>
  )
}

/** 懒加载页面的 Suspense 边界。不可包在 KeepAlive 外侧——react-activation 自带 Suspense 桥，
 * 外层再包一层会导致 onSuspenseEnd → setState 死循环（React #185）。 */
function LazyBoundary({ children }: { children: ReactNode }) {
  return <Suspense fallback={<RouteLoadingFallback />}>{children}</Suspense>
}

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

function AntdLocaleBridge({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation()
  const antdLocale = i18n.language === 'en' ? enUS : zhCN
  return (
    <ConfigProvider locale={antdLocale} theme={antdTheme}>
      {children}
    </ConfigProvider>
  )
}

function KeptPage({
  cacheKey,
  name,
  children,
}: {
  cacheKey: string
  name: string
  children: ReactNode
}) {
  return (
    <KeepAlive cacheKey={cacheKey} name={name} autoFreeze={false}>
      <LazyBoundary>{children}</LazyBoundary>
    </KeepAlive>
  )
}

/** 详情页按 :id 分别缓存，切走再切回同一个供应商配置时保留已选日期等状态 */
function DispatchPerformanceDetailRoute() {
  const { id } = useParams<{ id: string }>()
  return (
    <KeepAlive cacheKey={`page-dispatch-performance-detail-${id}`} name={`dispatch-performance-detail-${id}`} autoFreeze={false}>
      <LazyBoundary>
        <DispatchPerformanceDetailPage />
      </LazyBoundary>
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

function ScanStatEntry() {
  useEffect(() => {
    window.location.replace('/scan-stat.html')
  }, [])
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-600">
      正在打开扫描统计…
    </div>
  )
}

function DefaultHomeRedirect() {
  const { hasPermission, isSuperAdmin, loading, isAuthenticated } = useAuthStore()
  const { t } = useTranslation()
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-600">
        {t('loadingAuth')}
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
      <Route path="/login" element={<LazyBoundary><LoginPage /></LazyBoundary>} />
      {/* 供应商日报外部分享页：凭链接 token 访问，无需登录 */}
      <Route path="/vendor-daily/:token" element={<LazyBoundary><VendorPortalPage /></LazyBoundary>} />
      {/* 催派推送 / 24小时派签告警 共用同一个外部分享页组件：飞书群内打开，按路径区分数据源 */}
      <Route path="/chase-dispatch-share/:token" element={<LazyBoundary><ChaseDispatchSharePage /></LazyBoundary>} />
      <Route path="/dispatch-alarm-share/:token" element={<LazyBoundary><ChaseDispatchSharePage /></LazyBoundary>} />
      <Route element={<ProtectedRoute />}>
        <Route path="/scan-stat" element={<ScanStatEntry />} />
        <Route path="/vendor-snapshot" element={<LazyBoundary><VendorSnapshotPage /></LazyBoundary>} />
        <Route element={<AuthenticatedShell />}>
          <Route path="/" element={<DefaultHomeRedirect />} />
          <Route
            path="/efficiency"
            element={
              <KeptPage cacheKey="page-scanner-efficiency" name="scanner-efficiency">
                <ScannerEfficiencyPage />
              </KeptPage>
            }
          />
          <Route
            path="/efficiency-records"
            element={
              <LazyBoundary>
                <EfficiencyAttendanceRecordsPage />
              </LazyBoundary>
            }
          />
          <Route
            path="/wage-salary"
            element={
              <KeptPage cacheKey="page-wage-salary" name="wage-salary">
                <WageSalaryPage />
              </KeptPage>
            }
          />
          <Route
            path="/order-exception"
            element={
              <KeptPage cacheKey="page-order-exception" name="order-exception">
                <OrderExceptionManagementPage />
              </KeptPage>
            }
          />
          <Route
            path="/address-verify"
            element={
              <KeptPage cacheKey="page-address-verify" name="address-verify">
                <AddressVerifyPage />
              </KeptPage>
            }
          />
          <Route
            path="/new-merchant-monitor"
            element={
              <KeptPage cacheKey="page-new-merchant-monitor" name="new-merchant-monitor">
                <NewMerchantMonitorPage />
              </KeptPage>
            }
          />
          <Route
            path="/problem-package-audit"
            element={
              <KeptPage cacheKey="page-problem-package-audit" name="problem-package-audit">
                <ProblemPackageAuditPage />
              </KeptPage>
            }
          />
          <Route
            path="/return-to-merchant-finish"
            element={
              <KeptPage cacheKey="page-return-to-merchant-finish" name="return-to-merchant-finish">
                <ReturnToMerchantFinishPage />
              </KeptPage>
            }
          />
          <Route
            path="/vendor-analysis"
            element={
              <KeptPage cacheKey="page-vendor-analysis" name="vendor-analysis">
                <VendorAnalysisPage />
              </KeptPage>
            }
          />
          <Route
            path="/vendor-region-map"
            element={
              <KeptPage cacheKey="page-vendor-region-map" name="vendor-region-map">
                <VendorRegionMapPage />
              </KeptPage>
            }
          />
          <Route
            path="/exit-alarm"
            element={
              <KeptPage cacheKey="page-exit-alarm" name="exit-alarm">
                <ExitAlarmPage />
              </KeptPage>
            }
          />
          <Route
            path="/dispatch-alarm"
            element={
              <KeptPage cacheKey="page-dispatch-alarm" name="dispatch-alarm">
                <DispatchAlarmPage />
              </KeptPage>
            }
          />
          <Route
            path="/dispatch-performance"
            element={
              <KeptPage cacheKey="page-dispatch-performance" name="dispatch-performance">
                <DispatchPerformancePage />
              </KeptPage>
            }
          />
          {/* 子路由权限由 matchesSidebarActive 的前缀匹配自动继承 menu:dispatch-performance */}
          <Route path="/dispatch-performance/:id" element={<DispatchPerformanceDetailRoute />} />
          <Route
            path="/exit-rate-query"
            element={
              <KeptPage cacheKey="page-exit-rate-query" name="exit-rate-query">
                <ExitRateQueryPage />
              </KeptPage>
            }
          />
          <Route
            path="/chase-dispatch"
            element={
              <KeptPage cacheKey="page-chase-dispatch" name="chase-dispatch">
                <ChaseDispatchPage />
              </KeptPage>
            }
          />
          <Route
            path="/work-order-push"
            element={
              <KeptPage cacheKey="page-work-order-push" name="work-order-push">
                <WorkOrderPushPage />
              </KeptPage>
            }
          />
          <Route
            path="/push-notifications"
            element={
              <KeptPage cacheKey="page-push-notifications" name="push-notifications">
                <PushNotificationsPage />
              </KeptPage>
            }
          />
          <Route
            path="/supplier-content-push"
            element={
              <KeptPage cacheKey="page-supplier-content-push" name="supplier-content-push">
                <FleetSupplierPushPage />
              </KeptPage>
            }
          />
          <Route
            path="/push-engagement-monitor"
            element={
              <KeptPage cacheKey="page-push-engagement-monitor" name="push-engagement-monitor">
                <PushEngagementMonitorPage />
              </KeptPage>
            }
          />
          <Route
            path="/package-loss-monitor"
            element={
              <KeptPage cacheKey="page-package-loss-monitor" name="package-loss-monitor">
                <PackageLossMonitorPage />
              </KeptPage>
            }
          />
          <Route
            path="/warehouse-safety"
            element={
              <KeptPage cacheKey="page-warehouse-safety" name="warehouse-safety">
                <WarehouseSafetyInspectionPage />
              </KeptPage>
            }
          />
          <Route
            path="/attendance-work-time"
            element={
              <KeptPage cacheKey="page-attendance-work-time" name="attendance-work-time">
                <AttendanceWorkTimePage />
              </KeptPage>
            }
          />
          <Route
            path="/container/ledger"
            element={
              <KeptPage cacheKey="page-container-ledger" name="container-ledger">
                <ContainerLedgerPage />
              </KeptPage>
            }
          />
          <Route
            path="/container/accounts"
            element={
              <KeptPage cacheKey="page-container-accounts" name="container-accounts">
                <ContainerAccountsPage />
              </KeptPage>
            }
          />
          <Route
            path="/container/transfers"
            element={
              <KeptPage cacheKey="page-container-transfers" name="container-transfers">
                <ContainerTransfersPage />
              </KeptPage>
            }
          />
          <Route
            path="/system/users"
            element={
              <KeptPage cacheKey="page-system-users" name="system-users">
                <SystemUsersPage />
              </KeptPage>
            }
          />
          <Route
            path="/system/supplier-configs"
            element={
              <KeptPage cacheKey="page-supplier-configs" name="supplier-configs">
                <SupplierConfigPage />
              </KeptPage>
            }
          />
          <Route
            path="/system/priority-clients"
            element={
              <KeptPage cacheKey="page-priority-clients" name="priority-clients">
                <PriorityClientsPage />
              </KeptPage>
            }
          />
          <Route
            path="/system/region-package-prices"
            element={
              <KeptPage cacheKey="page-region-package-prices" name="region-package-prices">
                <RegionPackagePricePage />
              </KeptPage>
            }
          />
          <Route
            path="/system/warehouse-settings"
            element={
              <KeptPage cacheKey="page-warehouse-settings" name="warehouse-settings">
                <WarehouseSettingsPage />
              </KeptPage>
            }
          />
          <Route
            path="/system/region-calendar"
            element={
              <KeptPage cacheKey="page-region-calendar" name="region-calendar">
                <RegionCalendarPage />
              </KeptPage>
            }
          />
        </Route>
      </Route>
      <Route path="*" element={<DefaultHomeRedirect />} />
    </Routes>
  )
}

export default function App() {
  return (
    <I18nProvider>
      <AntdLocaleBridge>
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
      </AntdLocaleBridge>
    </I18nProvider>
  )
}
