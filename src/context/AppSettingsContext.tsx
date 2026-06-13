import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_IMILE_PORTAL_SETTINGS,
  IMILE_PORTAL_STORAGE_KEY,
  normalizeImilePortalSettings,
  readStoredImilePortalSettings,
  type ImilePortalSettings,
} from '../imile/imilePortalSettings'

/* Context 模块同时导出 Provider 与 hooks，故关闭 react-refresh 的仅导出组件规则。 */
/* eslint-disable react-refresh/only-export-components */

const GLOBAL_TOKEN_KEY = 'app_imile_bearer_token_v1'
const GLOBAL_REMEMBER_KEY = 'app_imile_token_remember_v1'
const LEGACY_TOKEN_KEY = 'order_exception_imile_token_v1'
const LEGACY_REMEMBER_KEY = 'order_exception_imile_remember_v1'

export type AppSettingsContextValue = {
  imileToken: string
  setImileToken: (value: string) => void
  rememberImileToken: boolean
  setRememberImileToken: (value: boolean) => void
  imilePortal: ImilePortalSettings
  setImilePortal: (value: ImilePortalSettings) => void
}

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null)

function migrateLegacyImileKeys(): void {
  if (typeof localStorage === 'undefined') return
  try {
    if (localStorage.getItem(GLOBAL_TOKEN_KEY) !== null) return
    const legacyToken = localStorage.getItem(LEGACY_TOKEN_KEY)
    if (legacyToken != null && legacyToken !== '') {
      localStorage.setItem(GLOBAL_TOKEN_KEY, legacyToken)
      const rawRemember = localStorage.getItem(LEGACY_REMEMBER_KEY)
      const remember = rawRemember === null ? true : rawRemember === '1'
      localStorage.setItem(GLOBAL_REMEMBER_KEY, remember ? '1' : '0')
    }
  } catch {
    /* ignore */
  }
}

function readRememberFlag(): boolean {
  if (typeof localStorage === 'undefined') return true
  try {
    migrateLegacyImileKeys()
    const raw = localStorage.getItem(GLOBAL_REMEMBER_KEY)
    if (raw === null) return true
    return raw === '1'
  } catch {
    return true
  }
}

function readStoredImileToken(): string {
  if (typeof localStorage === 'undefined') return ''
  try {
    migrateLegacyImileKeys()
    const remember = readRememberFlag()
    if (remember) {
      return localStorage.getItem(GLOBAL_TOKEN_KEY) ?? ''
    }
  } catch {
    /* ignore */
  }
  return ''
}

function readStoredImilePortal(): ImilePortalSettings {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_IMILE_PORTAL_SETTINGS }
  try {
    if (!readRememberFlag()) return { ...DEFAULT_IMILE_PORTAL_SETTINGS }
    return readStoredImilePortalSettings()
  } catch {
    return { ...DEFAULT_IMILE_PORTAL_SETTINGS }
  }
}

export function AppSettingsProvider({ children }: { children: React.ReactNode }) {
  const [imileToken, setImileToken] = useState(readStoredImileToken)
  const [rememberImileToken, setRememberImileToken] = useState(readRememberFlag)
  const [imilePortal, setImilePortalState] = useState(readStoredImilePortal)

  const setImilePortal = (value: ImilePortalSettings) => {
    setImilePortalState(normalizeImilePortalSettings(value))
  }

  useEffect(() => {
    try {
      localStorage.setItem(GLOBAL_REMEMBER_KEY, rememberImileToken ? '1' : '0')
      if (rememberImileToken) {
        localStorage.setItem(GLOBAL_TOKEN_KEY, imileToken)
        localStorage.setItem(IMILE_PORTAL_STORAGE_KEY, JSON.stringify(normalizeImilePortalSettings(imilePortal)))
      } else {
        localStorage.removeItem(GLOBAL_TOKEN_KEY)
        localStorage.removeItem(IMILE_PORTAL_STORAGE_KEY)
      }
    } catch {
      /* ignore */
    }
  }, [imileToken, rememberImileToken, imilePortal])

  const value = useMemo<AppSettingsContextValue>(
    () => ({
      imileToken,
      setImileToken,
      rememberImileToken,
      setRememberImileToken,
      imilePortal,
      setImilePortal,
    }),
    [imileToken, rememberImileToken, imilePortal],
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
