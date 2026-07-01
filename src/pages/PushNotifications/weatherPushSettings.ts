// 车队供应商推送「天气预报」开关与城市，持久化到 localStorage（设置一次后长期保留）
export type WeatherPushSettings = {
  enabled: boolean
  /** 城市预设 label，对应 WEATHER_LOCATION_PRESETS */
  city: string
}

export const DEFAULT_WEATHER_PUSH_SETTINGS: WeatherPushSettings = {
  enabled: false,
  city: '',
}

export const WEATHER_PUSH_STORAGE_KEY = 'app_fleet_supplier_weather_push_v1'

export function readWeatherPushSettings(): WeatherPushSettings {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_WEATHER_PUSH_SETTINGS }
  try {
    const raw = localStorage.getItem(WEATHER_PUSH_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_WEATHER_PUSH_SETTINGS }
    const o = JSON.parse(raw) as Partial<WeatherPushSettings>
    return {
      enabled: o?.enabled === true,
      city: typeof o?.city === 'string' ? o.city : '',
    }
  } catch {
    return { ...DEFAULT_WEATHER_PUSH_SETTINGS }
  }
}

export function writeWeatherPushSettings(settings: WeatherPushSettings): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(WEATHER_PUSH_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // 忽略写入失败（隐私模式/配额），不影响推送
  }
}
