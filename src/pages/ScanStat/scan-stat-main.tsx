import { useEffect, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import '../../index.css'
import { antdTheme } from '../../theme/antdTheme'
import { AppSettingsProvider } from '../../context/AppSettingsContext'
import { useAuthStore } from '../../stores/authStore'
import { ScanStatAuthGate } from './ScanStatAuthGate'

function AuthBootstrap({ children }: { children: ReactNode }) {
  const refreshMe = useAuthStore((s) => s.refreshMe)
  useEffect(() => {
    void refreshMe()
  }, [refreshMe])
  return <>{children}</>
}

createRoot(document.getElementById('root')!).render(
  <ConfigProvider locale={zhCN} theme={antdTheme}>
    <AuthBootstrap>
      <AppSettingsProvider>
        <ScanStatAuthGate />
      </AppSettingsProvider>
    </AuthBootstrap>
  </ConfigProvider>,
)
