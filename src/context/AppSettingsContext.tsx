import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { getUserPreference, putUserPreference } from '../api/userPreferencesApi'
import {
  DEFAULT_ZKT_ATTENDANCE_SETTINGS,
  normalizeZktAttendanceSettings,
  type ZktAttendanceSettings,
} from '../imile/zktAttendanceSettings'
import { useAuthStore } from '../stores/authStore'

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

export type UpdateSettingsResult = { ok: true } | { ok: false; error: string }

export type AppSettingsContextValue = {
  imileToken: string
  zktAttendance: ZktAttendanceSettings
  /** 服务端首次拉取是否已完成；拉取完成前 imileToken 等字段可能仍是默认值 */
  settingsLoaded: boolean
  /** 整体覆盖式保存，落地到当前登录账号的服务端偏好；成功后才更新本地状态 */
  updateSettings: (partial: Partial<StoredAppSettings>) => Promise<UpdateSettingsResult>
  /** 登录成功后调用，从服务端重新拉取当前账号的设置 */
  refreshSettings: () => Promise<void>
}

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null)

export function AppSettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<StoredAppSettings>(DEFAULT_APP_SETTINGS)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  /** 递增后作废进行中的 GET，避免旧响应用空/旧数据盖住刚保存的结果 */
  const revisionRef = useRef(0)

  const authLoading = useAuthStore((s) => s.loading)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  const refreshSettings = useCallback(async () => {
    const revision = ++revisionRef.current
    const result = await getUserPreference<Partial<StoredAppSettings>>(APP_SETTINGS_PREF_KEY)
    if (revision !== revisionRef.current) return
    setSettings(normalizeStoredAppSettings(result.ok ? result.data.value : null))
    setSettingsLoaded(true)
  }, [])

  useEffect(() => {
    if (authLoading) return

    if (!isAuthenticated) {
      revisionRef.current += 1
      setSettings(DEFAULT_APP_SETTINGS)
      setSettingsLoaded(true)
      return
    }

    void refreshSettings()
  }, [authLoading, isAuthenticated, refreshSettings])

  const updateSettings = useCallback(async (partial: Partial<StoredAppSettings>): Promise<UpdateSettingsResult> => {
    const next = normalizeStoredAppSettings({ ...settingsRef.current, ...partial })
    // 先作废进行中的 GET，再写入，防止「保存后旧拉取回来把本地盖掉」
    revisionRef.current += 1
    const result = await putUserPreference(APP_SETTINGS_PREF_KEY, next)
    if (!result.ok) {
      return { ok: false, error: result.error }
    }
    setSettings(next)
    settingsRef.current = next
    return { ok: true }
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
