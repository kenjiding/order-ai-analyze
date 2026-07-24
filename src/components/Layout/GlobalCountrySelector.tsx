import { Select } from 'antd'
import { Globe } from 'lucide-react'
import {
  GLOBAL_COUNTRY_OPTIONS,
  GLOBAL_SELECTED_COUNTRY_KEY,
  type GlobalCountryCode,
  useGlobalFilterStore,
} from '../../stores/globalFilterStore'

/**
 * Header 国家选择器：AUS / NZL，与责任站点选择器并排；选中值写入全局 store 并持久化。
 */
export function GlobalCountrySelector() {
  const { selectedCountry, setSelectedCountry } = useGlobalFilterStore()

  const handleChange = (value: GlobalCountryCode) => {
    setSelectedCountry(value)
    localStorage.setItem(GLOBAL_SELECTED_COUNTRY_KEY, JSON.stringify(value))
  }

  return (
    <div className="flex items-center">
      <Globe className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
      <Select
        variant="borderless"
        value={selectedCountry}
        onChange={handleChange}
        options={GLOBAL_COUNTRY_OPTIONS}
        placeholder="国家"
        suffixIcon={null}
        popupMatchSelectWidth={false}
      />
    </div>
  )
}
