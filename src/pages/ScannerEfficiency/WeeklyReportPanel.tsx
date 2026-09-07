import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Select } from 'antd'
import { copyTextToClipboard } from '../../utils/clipboard'
import type { ScanAggregate, AttendanceEfficiencyResult, ScannerEfficiencyResult } from './aggregates'
import type { ScanSettings } from './constants'
import { formatDateTime } from './formatAndParse'
import type { SourceInfo } from './sourceInfo'
import { buildWeeklyReportAnalysis, buildWeeklyReportEmailHtml, buildWeeklyReportTitle } from './weeklyReport'
import { getWeeklyReportRepository } from './weeklyReportRepository'
import { buildWeeklyReportSnapshot, type WeeklyReportSnapshot } from './weeklyReportSnapshot'
import { generateWeeklyAiAnalysis, type WeeklyReportAiProvider } from './openaiWeeklyReport'

const WEEKLY_REPORT_MODEL_OPTIONS: { value: WeeklyReportAiProvider; label: string }[] = [
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'openai', label: 'OpenAI' },
]

const normalizeMailtoCc = (raw: string): string =>
  raw
    .split(/[,;，；]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(',')

/** mailto 的 from 头；是否生效取决于本地邮件客户端（部分客户端会忽略）。 */
const WEEKLY_REPORT_MAIL_FROM = 'daniel.ding@imile.me'

export type WeeklyReportPanelProps = {
  scanAggregate: ScanAggregate
  attendanceResult: AttendanceEfficiencyResult | null
  scannerResult: ScannerEfficiencyResult | null
  scanSourceInfo: SourceInfo
  attendanceSourceInfo: SourceInfo
  settings: ScanSettings
  /** 与效率明细/天一致；无考勤或未算出时为 undefined */
  dailyCostPerTicketByDate?: Record<string, number | null>
  dailyTotalLaborCostByDate?: Record<string, number | null>
}

export default function WeeklyReportPanel({
  scanAggregate,
  attendanceResult,
  scannerResult,
  scanSourceInfo,
  attendanceSourceInfo,
  settings,
  dailyCostPerTicketByDate,
  dailyTotalLaborCostByDate,
}: WeeklyReportPanelProps) {
  const { t } = useTranslation('scannerEfficiency')
  const [weeklyReportHtml, setWeeklyReportHtml] = useState('')
  const [weeklyReportGeneratedAt, setWeeklyReportGeneratedAt] = useState('')
  const [weeklyReportHint, setWeeklyReportHint] = useState('')
  const [weeklyReportTitle, setWeeklyReportTitle] = useState(() =>
    buildWeeklyReportTitle(scanAggregate, attendanceResult),
  )
  const [weeklyMailCc, setWeeklyMailCc] = useState('')
  const [ccHistory, setCcHistory] = useState<string[]>([])
  const [generatingWeeklyReport, setGeneratingWeeklyReport] = useState(false)
  const [weeklyAiProvider, setWeeklyAiProvider] = useState<WeeklyReportAiProvider>('deepseek')

  useEffect(() => {
    const repository = getWeeklyReportRepository()
    if (!repository) return
    void repository
      .getMailCcPrefs()
      .then((prefs) => {
        setWeeklyMailCc(prefs.lastCc)
        setCcHistory(prefs.ccHistory)
      })
      .catch(() => {
        /* ignore */
      })
  }, [])

  const loadPreviousSnapshot = async (
    currentSnapshot: WeeklyReportSnapshot,
  ): Promise<{ previousSnapshot: WeeklyReportSnapshot | null; storageMessage: string }> => {
    const repository = getWeeklyReportRepository()
    if (!repository) {
      return {
        previousSnapshot: null,
        storageMessage: t('weekly.idbUnsupported'),
      }
    }

    try {
      await repository.pruneExpired()
      const previousSnapshot = await repository.findPreviousSnapshot(currentSnapshot.periodStart, currentSnapshot.periodEnd)
      return { previousSnapshot, storageMessage: '' }
    } catch {
      return {
        previousSnapshot: null,
        storageMessage: t('weekly.idbReadFailed'),
      }
    }
  }

  const saveCurrentSnapshot = async (currentSnapshot: WeeklyReportSnapshot): Promise<string> => {
    const repository = getWeeklyReportRepository()
    if (!repository) return ''

    try {
      await repository.save(currentSnapshot)
      await repository.pruneExpired()
      return ''
    } catch {
      return t('weekly.snapshotSaveFailed')
    }
  }

  const handleGenerateWeeklyReport = async () => {
    if (!scanAggregate) return
    setGeneratingWeeklyReport(true)

    try {
      const currentSnapshot = buildWeeklyReportSnapshot({
        scanAggregate,
        attendanceResult,
        scannerResult,
        scanSourceInfo,
        attendanceSourceInfo,
        settings,
        dailyCostPerTicketByDate,
        dailyTotalLaborCostByDate,
      })
      const { previousSnapshot, storageMessage } = await loadPreviousSnapshot(currentSnapshot)
      const reportAnalysis = buildWeeklyReportAnalysis({
        scanAggregate,
        attendanceResult,
        scannerResult,
        sourceInfo: scanSourceInfo,
        attendanceSourceInfo,
        currentSnapshot,
        previousSnapshot,
        attendanceDailyCostPerTicket: dailyCostPerTicketByDate,
        attendanceDailyTotalLaborCost: dailyTotalLaborCostByDate,
      })
      const summaryText = [
        reportAnalysis.conclusions.join(' '),
        reportAnalysis.diagnostics.map((item) => `${item.label}：${item.value}，${item.text}`).join(' '),
      ]
        .map((text) => text.trim())
        .filter(Boolean)
        .join(' ')
      let aiAnalysis: Awaited<ReturnType<typeof generateWeeklyAiAnalysis>> | null = null
      let aiHint = ''
      try {
        aiAnalysis = await generateWeeklyAiAnalysis({
          aiProvider: weeklyAiProvider,
          periodStart: currentSnapshot.periodStart,
          periodEnd: currentSnapshot.periodEnd,
          summaryText,
          currentMetrics: currentSnapshot.metrics,
          previousMetrics: previousSnapshot?.metrics ?? null,
          fallback: {
            conclusions: reportAnalysis.conclusions,
            diagnostics: reportAnalysis.diagnostics,
            actions: reportAnalysis.actions,
          },
        })
      } catch {
        aiHint = t('weekly.aiFallback')
      }
      const html = buildWeeklyReportEmailHtml({
        scanAggregate,
        attendanceResult,
        scannerResult,
        sourceInfo: scanSourceInfo,
        attendanceSourceInfo,
        currentSnapshot,
        previousSnapshot,
        aiAnalysis,
        attendanceDailyCostPerTicket: dailyCostPerTicketByDate,
        attendanceDailyTotalLaborCost: dailyTotalLaborCostByDate,
      })
      const saveMessage = await saveCurrentSnapshot(currentSnapshot)
      const baseMessage = previousSnapshot
        ? t('weekly.withComparison')
        : storageMessage || saveMessage
          ? t('weekly.noPreviousSnapshot')
          : t('weekly.snapshotSaved')

      setWeeklyReportHtml(html)
      setWeeklyReportGeneratedAt(formatDateTime(new Date()))
      setWeeklyReportHint([baseMessage, storageMessage, saveMessage, aiHint].filter(Boolean).join(' '))

      const repository = getWeeklyReportRepository()
      if (repository) {
        try {
          const prefs = await repository.mergeMailCcAfterGenerate(weeklyMailCc)
          setWeeklyMailCc(prefs.lastCc)
          setCcHistory(prefs.ccHistory)
        } catch {
          /* ignore */
        }
      }
    } finally {
      setGeneratingWeeklyReport(false)
    }
  }

  const handlePreviewWeeklyReport = () => {
    if (!weeklyReportHtml) return
    const previewWindow = window.open('', '_blank')
    if (!previewWindow) {
      setWeeklyReportHint(t('weekly.popupBlocked'))
      return
    }
    previewWindow.document.open()
    previewWindow.document.write(weeklyReportHtml)
    previewWindow.document.close()
  }

  const handleCopyWeeklyReport = async () => {
    if (!weeklyReportHtml) return
    const ok = await copyTextToClipboard(weeklyReportHtml)
    setWeeklyReportHint(ok ? t('weekly.copySuccess') : t('weekly.copyFailed'))
  }

  const handleDownloadWeeklyReport = () => {
    if (!weeklyReportHtml) return
    const blob = new Blob([weeklyReportHtml], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = t('weekly.downloadFilename')
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    setWeeklyReportHint(t('weekly.downloadSuccess'))
  }

  const handleOpenWeeklyReportMail = () => {
    if (!weeklyReportHtml) return
    const defaultTitle = buildWeeklyReportTitle(scanAggregate, attendanceResult)
    const subject = (weeklyReportTitle || defaultTitle).trim() || defaultTitle
    const body = t('weekly.mailBodyHint')
    const cc = normalizeMailtoCc(weeklyMailCc)
    const params = new URLSearchParams()
    params.set('subject', subject)
    params.set('body', body)
    params.set('from', WEEKLY_REPORT_MAIL_FROM)
    if (cc) params.set('cc', cc)
    const mailtoUrl = `mailto:?${params.toString()}`
    window.location.href = mailtoUrl
    setWeeklyReportHint(cc ? t('weekly.mailOpenedWithCc') : t('weekly.mailOpened'))
  }

  return (
    <section className="admin-panel p-5">
      <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-2 md:items-start md:gap-6">
        <div className="min-w-0">
          <label htmlFor="weekly-mail-title" className="mb-2 block text-sm font-medium text-slate-700">
            {t('weekly.mailTitleLabel')}
          </label>
          <input
            id="weekly-mail-title"
            type="text"
            value={weeklyReportTitle}
            onChange={(event) => setWeeklyReportTitle(event.target.value)}
            className="admin-input w-full"
            placeholder={t('weekly.mailTitlePlaceholder')}
          />
        </div>

        <div className="min-w-0">
          <label htmlFor="weekly-mail-cc" className="mb-2 block text-sm font-medium text-slate-700">
            {t('weekly.mailCcLabel')}
          </label>
          <input
            id="weekly-mail-cc"
            type="text"
            list="weekly-mail-cc-history"
            value={weeklyMailCc}
            onChange={(event) => setWeeklyMailCc(event.target.value)}
            className="admin-input w-full"
            placeholder={t('weekly.mailCcPlaceholder')}
            autoComplete="off"
          />
          <datalist id="weekly-mail-cc-history">
            {ccHistory.map((entry) => (
              <option key={entry} value={entry} />
            ))}
          </datalist>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleGenerateWeeklyReport()}
            disabled={generatingWeeklyReport}
            className="admin-btn admin-btn-primary"
          >
            {generatingWeeklyReport ? t('weekly.generating') : t('weekly.generate')}
          </button>
          <button
            type="button"
            onClick={handlePreviewWeeklyReport}
            disabled={!weeklyReportHtml}
            className="admin-btn"
          >
            {t('weekly.preview')}
          </button>
          <button
            type="button"
            onClick={handleOpenWeeklyReportMail}
            disabled={!weeklyReportHtml}
            className="admin-btn"
          >
            {t('weekly.openMail')}
          </button>
          <button
            type="button"
            onClick={() => void handleCopyWeeklyReport()}
            disabled={!weeklyReportHtml}
            className="admin-btn"
          >
            {t('weekly.copyHtml')}
          </button>
          <button
            type="button"
            onClick={handleDownloadWeeklyReport}
            disabled={!weeklyReportHtml}
            className="admin-btn"
          >
            {t('weekly.downloadHtml')}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-600">
          <span className="shrink-0">{t('weekly.modelLabel')}</span>
          <Select<WeeklyReportAiProvider>
            className="min-w-[140px]"
            value={weeklyAiProvider}
            options={WEEKLY_REPORT_MODEL_OPTIONS}
            disabled={generatingWeeklyReport}
            onChange={(value) => setWeeklyAiProvider(value)}
            aria-label={t('weekly.modelAria')}
          />
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        {weeklyReportGeneratedAt
          ? t('weekly.lastGenerated', { time: weeklyReportGeneratedAt })
          : t('weekly.notGenerated')}
        <br />
        {weeklyReportHint || t('weekly.defaultHint')}
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        {weeklyReportHtml ? (
          <iframe
            title={t('weekly.previewIframeTitle')}
            srcDoc={weeklyReportHtml}
            className="h-[560px] w-full rounded-lg border border-slate-200 bg-white"
          />
        ) : (
          <div className="flex h-[560px] items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-sm text-slate-500">
            {t('weekly.previewEmpty')}
          </div>
        )}
      </div>
    </section>
  )
}
