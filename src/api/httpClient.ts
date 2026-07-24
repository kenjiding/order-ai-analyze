import { getApiBaseUrl } from '../utils/apiBaseUrl'
import { useGlobalFilterStore } from '../stores/globalFilterStore'

/**
 * 全项目唯一的后端请求入口：统一拼接 base url、带上登录态 Cookie，
 * 并自动附加当前「站点选择器」的 hubcode、「国家选择器」的 country 请求头，
 * 供后端调用 iMile 接口时透传。
 */
export async function backendFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers)
  const { selectedStations, selectedCountry } = useGlobalFilterStore.getState()
  const hubcode = selectedStations[0]
  if (hubcode) headers.set('hubcode', hubcode)
  if (selectedCountry) headers.set('country', selectedCountry)

  return fetch(`${getApiBaseUrl()}${path}`, {
    ...options,
    credentials: 'include',
    headers,
  })
}
