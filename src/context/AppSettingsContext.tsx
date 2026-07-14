import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { getUserPreference, putUserPreference } from '../api/userPreferencesApi'
import {
  DEFAULT_ZKT_ATTENDANCE_SETTINGS,
  normalizeZktAttendanceSettings,
  type ZktAttendanceSettings,
} from '../imile/zktAttendanceSettings'

/* Context 模块同时导出 Provider 与 hooks，故关闭 react-refresh 的仅导出组件规则。 */
/* eslint-disable react-refresh/only-export-components */

/** 系统设置绑定到登录账号，存储在服务端 user_preferences 表，跨设备登录同一账号即可读到 */
const APP_SETTINGS_PREF_KEY = 'app-settings'

export type StoredAppSettings = {
  imileToken: string
  zktAttendance: ZktAttendanceSettings
}

const DEFAULT_APP_SETTINGS: StoredAppSettings = {
  imileToken: '',
  zktAttendance: { ...DEFAULT_ZKT_ATTENDANCE_SETTINGS },
}

function normalizeStoredAppSettings(raw: Partial<StoredAppSettings> | null | undefined): StoredAppSettings {
  return {
    imileToken: String(raw?.imileToken ?? ''),
    zktAttendance: normalizeZktAttendanceSettings(raw?.zktAttendance),
  }
}

export type AppSettingsContextValue = {
  imileToken: string
  zktAttendance: ZktAttendanceSettings
  /** 服务端首次拉取是否已完成；拉取完成前 imileToken 等字段可能仍是默认值 */
  settingsLoaded: boolean
  /** 整体覆盖式保存，落地到当前登录账号的服务端偏好 */
  updateSettings: (partial: Partial<StoredAppSettings>) => void
  /** 登录成功后调用，从服务端重新拉取当前账号的设置 */
  refreshSettings: () => Promise<void>
}

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null)

export function AppSettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<StoredAppSettings>(DEFAULT_APP_SETTINGS)
  const [settingsLoaded, setSettingsLoaded] = useState(false)

  const refreshSettings = useCallback(async () => {
    const result = await getUserPreference<Partial<StoredAppSettings>>(APP_SETTINGS_PREF_KEY)
    setSettings(normalizeStoredAppSettings(result.ok ? result.data.value : null))
    setSettingsLoaded(true)
  }, [])

  useEffect(() => {
    let ignore = false
    async function bootstrap() {
      const result = await getUserPreference<Partial<StoredAppSettings>>(APP_SETTINGS_PREF_KEY)
      if (ignore) return
      setSettings(normalizeStoredAppSettings(result.ok ? result.data.value : null))
      setSettingsLoaded(true)
    }
    void bootstrap()
    return () => {
      ignore = true
    }
  }, [])

  const updateSettings = useCallback((partial: Partial<StoredAppSettings>) => {
    setSettings((prev) => {
      const next = normalizeStoredAppSettings({ ...prev, ...partial })
      void putUserPreference(APP_SETTINGS_PREF_KEY, next)
      return next
    })
  }, [])

  const value = useMemo<AppSettingsContextValue>(
    () => ({
      imileToken: settings.imileToken,
      zktAttendance: settings.zktAttendance,
      settingsLoaded,
      updateSettings,
      refreshSettings,
    }),
    [settings, settingsLoaded, updateSettings, refreshSettings],
  )

  return <AppSettingsContext.Provider value={value}>{children}</AppSettingsContext.Provider>
}

export function useAppSettings(): AppSettingsContextValue {
  const ctx = useContext(AppSettingsContext)
  if (!ctx) {
    throw new Error('useAppSettings must be used within AppSettingsProvider')
  }
  return ctx
}

/** 仅在已挂载 Provider 的包内使用；用于可选场景时返回 null */
export function useAppSettingsOptional(): AppSettingsContextValue | null {
  return useContext(AppSettingsContext)
}
