// 车队供应商推送「拉取入站数据」弹窗里多选的站点，持久化到 localStorage，下次打开自动回填
export const PENDING_BOX_STATIONS_STORAGE_KEY = 'app_fleet_supplier_pending_box_stations_v1'

export function readPendingBoxStations(): string[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(PENDING_BOX_STATIONS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

export function writePendingBoxStations(stations: string[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(PENDING_BOX_STATIONS_STORAGE_KEY, JSON.stringify(stations))
  } catch {
    // 忽略写入失败（隐私模式/配额），不影响拉取
  }
}
