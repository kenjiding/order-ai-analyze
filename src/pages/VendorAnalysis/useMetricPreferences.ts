import { useCallback, useEffect, useMemo, useState } from 'react'
import { getUserPreference, putUserPreference } from '../../api/userPreferencesApi'
import { showToast } from '../../utils/toast'
import {
  DEFAULT_METRIC_PREFERENCES,
  METRIC_PREF_KEY,
  resolveEnabledMetricKeys,
  type MetricPreferencesValue,
} from './metricsRegistry'

export type MetricPreferences = {
  loading: boolean
  saving: boolean
  /** 已应用的偏好原始值（配置面板打开时以此初始化草稿） */
  value: MetricPreferencesValue
  /** 生效的指标 key（固定 + 勾选），顺序与 registry 一致 */
  enabledKeys: string[]
  enabledSet: ReadonlySet<string>
  aiSummaryEnabled: boolean
  /** 显式保存：先写服务端，成功后才应用到页面；返回是否成功 */
  save: (next: MetricPreferencesValue) => Promise<boolean>
  /**
   * 仅本地生效、不写服务端：用于「查看数据」还原历史任务当时的指标勾选状态。
   * 刷新页面后会回落到服务端已保存的偏好；如需长期保留需用户在配置面板显式点「保存」。
   */
  applyLocal: (next: MetricPreferencesValue) => void
}

/**
 * 指标勾选偏好：服务端按用户保存（跨设备一致）。
 * 配置面板内的更改是草稿，点击「保存」才落库并应用；保存失败提示且不应用。
 */
export function useMetricPreferences(): MetricPreferences {
  const [prefs, setPrefs] = useState<MetricPreferencesValue>(DEFAULT_METRIC_PREFERENCES)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void getUserPreference<MetricPreferencesValue>(METRIC_PREF_KEY).then((res) => {
      if (cancelled) return
      setLoading(false)
      if (res.ok && res.data.value && res.data.value.v === 1) {
        setPrefs({
          v: 1,
          overrides: res.data.value.overrides ?? {},
          aiSummaryEnabled: res.data.value.aiSummaryEnabled !== false,
        })
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const save = useCallback(async (next: MetricPreferencesValue): Promise<boolean> => {
    setSaving(true)
    const res = await putUserPreference(METRIC_PREF_KEY, next)
    setSaving(false)
    if (!res.ok) {
      showToast(`指标配置保存失败：${res.error}`, 'error')
      return false
    }
    setPrefs(next)
    showToast('指标配置已保存', 'success')
    return true
  }, [])

  const applyLocal = useCallback((next: MetricPreferencesValue) => {
    setPrefs(next)
  }, [])

  const enabledKeys = useMemo(() => resolveEnabledMetricKeys(prefs), [prefs])
  const enabledSet = useMemo(() => new Set(enabledKeys), [enabledKeys])

  return {
    loading,
    saving,
    value: prefs,
    enabledKeys,
    enabledSet,
    aiSummaryEnabled: prefs.aiSummaryEnabled,
    save,
    applyLocal,
  }
}
