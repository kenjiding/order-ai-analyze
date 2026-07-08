/** BOM 每日预报单日原始结构（api.weather.bom.gov.au/v1/.../forecasts/daily） */
export type BomDailyForecast = {
  /** ISO 时间字符串，UTC */
  date: string
  rain?: {
    chance?: number | null
    amount?: { min?: number | null; max?: number | null; units?: string | null } | null
  } | null
  /** 天气图标标识，如 sunny/showers/rain/storm/windy/hail 等 */
  icon_descriptor?: string | null
  short_text?: string | null
  extended_text?: string | null
  temp_min?: number | null
  temp_max?: number | null
}

/** 派送影响等级 */
export type WeatherImpactLevel = 'severe' | 'moderate' | 'mild' | 'normal'

/** 面向派送的单日天气摘要 */
export type DeliveryWeatherDay = {
  /** 展示用日期标签，如「明天(周三)」 */
  dateLabel: string
  impactLevel: WeatherImpactLevel
  /** 影响文案，如「雷暴/冰雹」「强降雨」「大风」「适宜派送」 */
  impactLabel: string
  /** 降雨概率 %，无则 null */
  rainChance: number | null
  /** 降雨量文案，如「2-5mm」，无则 null */
  rainAmount: string | null
  /** BOM 简述（short_text） */
  summary: string
}

/** 附加到卡片的天气块 */
export type DeliveryWeatherBlock = {
  locationLabel: string
  days: DeliveryWeatherDay[]
}
