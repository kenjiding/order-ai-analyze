import { create } from 'zustand'
import type { StationOption } from '../pages/VendorAnalysis/vendorAnalysisTypes'

type GlobalFilterState = {
  selectedStations: string[]
  stations: StationOption[]
  stationsLoading: boolean
  setSelectedStations: (stations: string[]) => void
  setStations: (stations: StationOption[]) => void
  setStationsLoading: (loading: boolean) => void
}

export const useGlobalFilterStore = create<GlobalFilterState>((set) => ({
  selectedStations: [],
  stations: [],
  stationsLoading: false,
  setSelectedStations: (selectedStations) => set({ selectedStations }),
  setStations: (stations) => set({ stations }),
  setStationsLoading: (stationsLoading) => set({ stationsLoading }),
}))
