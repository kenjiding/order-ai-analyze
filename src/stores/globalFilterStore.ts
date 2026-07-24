import { create } from 'zustand'
import type { StationOption } from '../pages/VendorAnalysis/vendorAnalysisTypes'

/** 顶部国家选择器可选值 */
export type GlobalCountryCode = 'AUS' | 'NZL'

export const GLOBAL_COUNTRY_OPTIONS: { label: string; value: GlobalCountryCode }[] = [
  { label: 'AUS', value: 'AUS' },
  { label: 'NZL', value: 'NZL' },
]

export const GLOBAL_SELECTED_COUNTRY_KEY = 'global_selected_country_v1'

const COUNTRY_VALUES = new Set<string>(GLOBAL_COUNTRY_OPTIONS.map((o) => o.value))

function isCountryCode(value: unknown): value is GlobalCountryCode {
  return typeof value === 'string' && COUNTRY_VALUES.has(value)
}

/** 同步从 localStorage 读出，避免首屏站点列表仍按默认 AUS 拉取 */
function readStoredCountry(): GlobalCountryCode {
  try {
    const raw = localStorage.getItem(GLOBAL_SELECTED_COUNTRY_KEY)
    if (!raw) return 'AUS'
    const parsed = JSON.parse(raw) as unknown
    return isCountryCode(parsed) ? parsed : 'AUS'
  } catch {
    return 'AUS'
  }
}

type GlobalFilterState = {
  selectedStations: string[]
  /** 当前选中国家，默认 AUS */
  selectedCountry: GlobalCountryCode
  stations: StationOption[]
  stationsLoading: boolean
  setSelectedStations: (stations: string[]) => void
  setSelectedCountry: (country: GlobalCountryCode) => void
  setStations: (stations: StationOption[]) => void
  setStationsLoading: (loading: boolean) => void
}

export const useGlobalFilterStore = create<GlobalFilterState>((set) => ({
  selectedStations: [],
  selectedCountry: readStoredCountry(),
  stations: [],
  stationsLoading: false,
  setSelectedStations: (selectedStations) => set({ selectedStations }),
  setSelectedCountry: (selectedCountry) => set({ selectedCountry }),
  setStations: (stations) => set({ stations }),
  setStationsLoading: (stationsLoading) => set({ stationsLoading }),
}))
