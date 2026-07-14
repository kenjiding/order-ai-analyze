import { backendFetch } from '../../api/httpClient'
import type { WeeklyReportSnapshot } from './weeklyReportSnapshot'

export type WeeklyAiAnalysis = {
  summary: string[]
  prediction: string[]
  prevention: string[]
}

export type WeeklyReportAiProvider = 'openai' | 'deepseek'

type WeeklyAiRequestPayload = {
  aiProvider?: WeeklyReportAiProvider
  periodStart: string
  periodEnd: string
  summaryText: string
  currentMetrics: WeeklyReportSnapshot['metrics']
  previousMetrics: WeeklyReportSnapshot['metrics'] | null
  fallback: {
    conclusions: string[]
    diagnostics: { label: string; value: string; text: string }[]
    actions: string[]
  }
}

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item ?? '').trim()).filter(Boolean)
}

export async function generateWeeklyAiAnalysis(payload: WeeklyAiRequestPayload): Promise<WeeklyAiAnalysis> {
  const response = await backendFetch('/api/weekly-report-insight', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `HTTP ${response.status}`)
  }

  const data = (await response.json()) as { analysis?: unknown }
  const analysis = (data?.analysis ?? {}) as Record<string, unknown>
  const parsed: WeeklyAiAnalysis = {
    summary: asStringArray(analysis.summary),
    prediction: asStringArray(analysis.prediction),
    prevention: asStringArray(analysis.prevention),
  }

  if (!parsed.summary.length && !parsed.prediction.length && !parsed.prevention.length) {
    throw new Error('研判段落返回为空')
  }

  return parsed
}
