// 天气预报城市预设（对应 server/src/imile/ausTimezone.ts 的 AUS_TZ 城市），内置坐标
export type WeatherLocationPreset = {
  label: string
  lat: number
  lng: number
}

export const WEATHER_LOCATION_PRESETS: WeatherLocationPreset[] = [
  { label: 'Adelaide', lat: -34.9285, lng: 138.6007 },
  { label: 'Melbourne', lat: -37.8136, lng: 144.9631 },
  { label: 'Sydney', lat: -33.8688, lng: 151.2093 },
  { label: 'Perth', lat: -31.9523, lng: 115.8613 },
  { label: 'Brisbane', lat: -27.4698, lng: 153.0251 },
  { label: 'Canberra', lat: -35.2809, lng: 149.13 },
]
