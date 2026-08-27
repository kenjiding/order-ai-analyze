import { useEffect, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import '../../index.css'
import './returnToMerchant.css'
import { antdTheme } from '../../theme/antdTheme'
import { AppSettingsProvider } from '../../context/AppSettingsContext'
import { useAuthStore } from '../../stores/authStore'
import { ReturnToMerchantAuthGate } from './ReturnToMerchantAuthGate'

/**
 * 与主站 App.tsx 相同：必须先 refreshMe，AppSettingsProvider 才知道已登录，
 * 才会拉取账号偏好里的 iMile Token，责任站点列表才能请求。
 */
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
        <ReturnToMerchantAuthGate />
      </AppSettingsProvider>
    </AuthBootstrap>
  </ConfigProvider>,
)
