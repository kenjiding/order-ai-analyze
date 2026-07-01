import { AUS_TZ } from '../imile/ausTimezone'
import type {
  BomDailyForecast,
  DeliveryWeatherBlock,
  DeliveryWeatherDay,
  WeatherImpactLevel,
} from './types'

const IMPACT_EMOJI: Record<WeatherImpactLevel, string> = {
  severe: '🔴',
  moderate: '🟠',
  mild: '🟡',
  normal: '🟢',
}

// 飞书 lark_md 富文本颜色
const IMPACT_FONT_COLOR: Record<WeatherImpactLevel, string> = {
  severe: 'red',
  moderate: 'orange',
  mild: 'grey',
  normal: 'green',
}

/** 从 BOM 的 UTC 日期字符串取阿德莱德时区的英文星期缩写（Mon/Tue/...） */
function weekdayShort(isoDate: string, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(
    new Date(isoDate),
  )
}

function rainAmountText(day: BomDailyForecast): string | null {
  const amt = day.rain?.amount
  if (!amt) return null
  const min = amt.min ?? 0
  const max = amt.max
  const units = amt.units ?? 'mm'
  if (max == null || max === 0) return null
  return min && min !== max ? `${min}-${max}${units}` : `${max}${units}`
}

/** 依据图标 + 降雨概率/雨量判定派送影响等级 */
function assessImpact(day: BomDailyForecast): { level: WeatherImpactLevel; label: string } {
  const icon = (day.icon_descriptor ?? '').toLowerCase()
  const chance = day.rain?.chance ?? 0
  const maxAmount = day.rain?.amount?.max ?? 0

  if (/storm|cyclone|hail/.test(icon)) {
    return { level: 'severe', label: 'Thunderstorm/Hail · stay safe, delays likely' }
  }
  if (/heavy/.test(icon) || ((/rain|shower/.test(icon)) && (chance >= 70 || maxAmount >= 15))) {
    return { level: 'severe', label: 'Heavy rain · keep the shipping label dry, efficiency will drop' }
  }
  if (/wind/.test(icon)) {
    return { level: 'moderate', label: 'Strong wind · handle parcels carefully' }
  }
  if (/rain|shower/.test(icon)) {
    if (chance >= 50 || maxAmount >= 5) {
      return { level: 'moderate', label: 'Rain · keep the shipping label dry, may slow delivery' }
    }
    return { level: 'mild', label: 'Light showers · keep the label dry, minor impact' }
  }
  if (/fog|frost|snow|dust/.test(icon)) {
    return { level: 'moderate', label: 'Low visibility / poor road conditions' }
  }
  return { level: 'normal', label: 'Good for delivery' }
}

function toDeliveryDay(day: BomDailyForecast, prefix: string, tz: string): DeliveryWeatherDay {
  const { level, label } = assessImpact(day)
  return {
    dateLabel: `${prefix} (${weekdayShort(day.date, tz)})`,
    impactLevel: level,
    impactLabel: label,
    rainChance: day.rain?.chance ?? null,
    rainAmount: rainAmountText(day),
    summary: (day.short_text ?? '').trim(),
  }
}

/**
 * 从 BOM 每日预报构建面向派送的天气块（明天 + 后天）。
 * data[0]=今天，data[1]=明天，data[2]=后天。
 */
export function buildDeliveryWeather(
  forecast: BomDailyForecast[],
  locationLabel: string,
): DeliveryWeatherBlock | null {
  const tz = AUS_TZ.Adelaide
  const days: DeliveryWeatherDay[] = []
  if (forecast[1]) days.push(toDeliveryDay(forecast[1], 'Tomorrow', tz))
  if (forecast[2]) days.push(toDeliveryDay(forecast[2], 'Day after', tz))
  if (days.length === 0) return null
  return { locationLabel, days }
}

/** 把派送天气块渲染为飞书 lark_md 文本，供富文本推送合并使用 */
export function renderDeliveryWeatherLarkMd(block: DeliveryWeatherBlock): string {
  const lines: string[] = [`🌦️ **${block.locationLabel} Weather Forecast**`]
  // 只提醒会影响派送的日子；正常天气不逐条输出
  const impactDays = block.days.filter((d) => d.impactLevel !== 'normal')
  if (impactDays.length === 0) {
    lines.push(`<font color='green'>🟢 No adverse weather over the next two days — good for delivery.</font>`)
    return lines.join('\n')
  }
  for (const day of impactDays) {
    const impact = `<font color='${IMPACT_FONT_COLOR[day.impactLevel]}'>${IMPACT_EMOJI[day.impactLevel]} ${day.impactLabel}</font>`
    const rain: string[] = []
    if (day.rainChance != null) rain.push(`Rain ${day.rainChance}%`)
    if (day.rainAmount) rain.push(day.rainAmount)
    const tail = [rain.join(' · '), day.summary].filter(Boolean).join(' · ')
    lines.push(`**${day.dateLabel}** ${impact}${tail ? ` · ${tail}` : ''}`)
  }
  return lines.join('\n')
}
