import { useEffect, useState } from 'react'
import { Select } from 'antd'
import type { ScanAggregate, AttendanceEfficiencyResult, ScannerEfficiencyResult } from './aggregates'
import type { ScanSettings } from './constants'
import { formatDateTime } from './formatAndParse'
import type { SourceInfo } from './exportWorkbook'
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
}

export default function WeeklyReportPanel({
  scanAggregate,
  attendanceResult,
  scannerResult,
  scanSourceInfo,
  attendanceSourceInfo,
  settings,
  dailyCostPerTicketByDate,
}: WeeklyReportPanelProps) {
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
        storageMessage: '当前浏览器不支持 IndexedDB，本次无法保存或读取上周对比数据。',
      }
    }

    try {
      await repository.pruneExpired()
      const previousSnapshot = await repository.findPreviousSnapshot(currentSnapshot.periodStart, currentSnapshot.periodEnd)
      return { previousSnapshot, storageMessage: '' }
    } catch {
      return {
        previousSnapshot: null,
        storageMessage: '读取 IndexedDB 历史周报失败，本次仅生成当前周分析。',
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
      return '保存本周快照失败，下次可能无法进行上周对比。'
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
        aiHint = '研判段落生成失败，已回退为系统内置结论与建议。'
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
      })
      const saveMessage = await saveCurrentSnapshot(currentSnapshot)
      const baseMessage = previousSnapshot
        ? '周报已加入上周同口径对比。'
        : storageMessage || saveMessage
          ? '未读取到上周快照，本次仅生成当前周分析。'
          : '未找到上周快照，本周快照已保存供下次对比。'

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
      setWeeklyReportHint('浏览器拦截了新窗口，请允许弹窗后重试。')
      return
    }
    previewWindow.document.open()
    previewWindow.document.write(weeklyReportHtml)
    previewWindow.document.close()
  }

  const handleCopyWeeklyReport = async () => {
    if (!weeklyReportHtml) return
    try {
      await navigator.clipboard.writeText(weeklyReportHtml)
      setWeeklyReportHint('周报 HTML 已复制到剪贴板。')
    } catch {
      setWeeklyReportHint('复制失败，请改用下载功能。')
    }
  }

  const handleDownloadWeeklyReport = () => {
    if (!weeklyReportHtml) return
    const blob = new Blob([weeklyReportHtml], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = '仓库效率周报邮件.html'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    setWeeklyReportHint('周报 HTML 已下载。')
  }

  const handleOpenWeeklyReportMail = () => {
    if (!weeklyReportHtml) return
    const defaultTitle = buildWeeklyReportTitle(scanAggregate, attendanceResult)
    const subject = (weeklyReportTitle || defaultTitle).trim() || defaultTitle
    const body = '周报正文请粘贴“周报 HTML 源码”内容，建议使用支持 HTML 的邮件编辑器发送。'
    const cc = normalizeMailtoCc(weeklyMailCc)
    const params = new URLSearchParams()
    params.set('subject', subject)
    params.set('body', body)
    params.set('from', WEEKLY_REPORT_MAIL_FROM)
    if (cc) params.set('cc', cc)
    const mailtoUrl = `mailto:?${params.toString()}`
    window.location.href = mailtoUrl
    setWeeklyReportHint(cc ? '已打开默认邮件客户端，并填充标题与抄送人。' : '已打开默认邮件客户端，并自动填充邮件标题。')
  }

  return (
    <section className="admin-panel p-5">
      <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-2 md:items-start md:gap-6">
        <div className="min-w-0">
          <label htmlFor="weekly-mail-title" className="mb-2 block text-sm font-medium text-slate-700">
            周报邮件标题
          </label>
          <input
            id="weekly-mail-title"
            type="text"
            value={weeklyReportTitle}
            onChange={(event) => setWeeklyReportTitle(event.target.value)}
            className="admin-input w-full"
            placeholder="仓库效率周报"
          />
        </div>

        <div className="min-w-0">
          <label htmlFor="weekly-mail-cc" className="mb-2 block text-sm font-medium text-slate-700">
            邮件抄送人
          </label>
          <input
            id="weekly-mail-cc"
            type="text"
            list="weekly-mail-cc-history"
            value={weeklyMailCc}
            onChange={(event) => setWeeklyMailCc(event.target.value)}
            className="admin-input w-full"
            placeholder="多个邮箱请用逗号分隔，示例：zhang@corp.com, li@corp.com"
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
            {generatingWeeklyReport ? '生成中…' : '生成周报 HTML'}
          </button>
          <button
            type="button"
            onClick={handlePreviewWeeklyReport}
            disabled={!weeklyReportHtml}
            className="admin-btn"
          >
            新窗口预览
          </button>
          <button
            type="button"
            onClick={handleOpenWeeklyReportMail}
            disabled={!weeklyReportHtml}
            className="admin-btn"
          >
            打开邮件
          </button>
          <button
            type="button"
            onClick={() => void handleCopyWeeklyReport()}
            disabled={!weeklyReportHtml}
            className="admin-btn"
          >
            复制 HTML
          </button>
          <button
            type="button"
            onClick={handleDownloadWeeklyReport}
            disabled={!weeklyReportHtml}
            className="admin-btn"
          >
            下载 HTML
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-600">
          <span className="shrink-0">研判模型</span>
          <Select<WeeklyReportAiProvider>
            className="min-w-[140px]"
            value={weeklyAiProvider}
            options={WEEKLY_REPORT_MODEL_OPTIONS}
            disabled={generatingWeeklyReport}
            onChange={(value) => setWeeklyAiProvider(value)}
            aria-label="选择周报研判模型"
          />
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        {weeklyReportGeneratedAt
          ? `最近生成时间：${weeklyReportGeneratedAt}`
          : '尚未生成周报，请点击“生成周报 HTML”。'}
        <br />
        {weeklyReportHint || '周报会按当前页面口径自动重构。'}
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        {weeklyReportHtml ? (
          <iframe
            title="周报预览"
            srcDoc={weeklyReportHtml}
            className="h-[560px] w-full rounded-lg border border-slate-200 bg-white"
          />
        ) : (
          <div className="flex h-[560px] items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-sm text-slate-500">
            生成后将显示周报预览。
          </div>
        )}
      </div>
    </section>
  )
}
