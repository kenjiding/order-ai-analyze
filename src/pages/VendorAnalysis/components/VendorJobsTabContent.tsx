import { Button, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { Loader2, Play, RefreshCw } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { JobStatus, PublicJob } from '../vendorAnalysisApi'
import { ALL_METRIC_KEYS, metricDisplayLabel } from '../metricsRegistry'

function MetricKeysCell({ job }: { job: PublicJob }) {
  const { t } = useTranslation('vendorAnalysis')
  const keys = Array.isArray(job.payload.metricKeys)
    ? (job.payload.metricKeys as unknown[]).filter((k): k is string => typeof k === 'string')
    : null
  if (!keys) return <Tag className="mr-0" color="default">{t('allMetrics')}</Tag>
  if (keys.length === 0) return <span className="text-slate-400">—</span>
  if (keys.length >= ALL_METRIC_KEYS.length) return <Tag className="mr-0" color="blue">{t('allMetrics')}</Tag>
  const labels = keys.map(metricDisplayLabel).join('、')
  return (
    <Tooltip title={labels}>
      <span className="text-slate-600 line-clamp-2">{labels}</span>
    </Tooltip>
  )
}

type Props = {
  jobs: PublicJob[]
  isLoading: boolean
  loadingJobId: string | null
  onRefresh: () => void
  onLoadResults: (jobId: string) => void
  onEdit: (job: PublicJob) => void
  onShare?: (job: PublicJob) => void
  onCancel: (jobId: string) => void
  onDelete: (jobId: string) => void
  onRetry: (job: PublicJob) => void
  stationNameMap?: Record<string, string>
  headerAction?: ReactNode
}

function useRelativeTimeFormatter() {
  const { t } = useTranslation('common')
  return (isoString: string) => {
    const diffMs = Date.now() - new Date(isoString).getTime()
    const diffMin = Math.floor(diffMs / 60_000)
    if (diffMin < 1) return t('relativeJustNow')
    if (diffMin < 60) return t('relativeMinutesAgo', { count: diffMin })
    const diffHr = Math.floor(diffMin / 60)
    if (diffHr < 24) return t('relativeHoursAgo', { count: diffHr })
    return t('relativeDaysAgo', { count: Math.floor(diffHr / 24) })
  }
}

function getStationCodes(job: PublicJob): string[] {
  return Array.isArray(job.payload.stationCodes) ? (job.payload.stationCodes as string[]) : []
}

function getDateRangeLabel(job: PublicJob): string {
  const start = typeof job.payload.startTime === 'string' ? job.payload.startTime.slice(0, 10) : ''
  const end = typeof job.payload.endTime === 'string' ? job.payload.endTime.slice(0, 10) : ''
  return start && end ? `${start} ~ ${end}` : '—'
}

function getReferenceDate(job: PublicJob): string {
  return typeof job.payload.referenceDate === 'string' && job.payload.referenceDate ? job.payload.referenceDate : '—'
}

function getProgress(job: PublicJob): string {
  const p = job.progress
  const phase = typeof p.phase === 'string' ? p.phase : ''
  const message = typeof p.message === 'string' ? p.message : ''
  const percent = typeof p.percent === 'number' ? `${p.percent}%` : ''
  return [phase && `[${phase}]`, message, percent].filter(Boolean).join(' ') || '—'
}

function buildColumns(
  t: (key: string, opts?: Record<string, unknown>) => string,
  tc: (key: string, opts?: Record<string, unknown>) => string,
  formatRelativeTime: (iso: string) => string,
  loadingJobId: string | null,
  onLoadResults: (jobId: string) => void,
  onEdit: (job: PublicJob) => void,
  onShare: ((job: PublicJob) => void) | undefined,
  onCancel: (jobId: string) => void,
  onDelete: (jobId: string) => void,
  onRetry: (job: PublicJob) => void,
  stationNameMap: Record<string, string>,
): ColumnsType<PublicJob> {
  const statusColor: Record<JobStatus, 'warning' | 'processing' | 'success' | 'error' | 'default'> = {
    pending: 'warning',
    running: 'processing',
    succeeded: 'success',
    failed: 'error',
    cancelled: 'default',
  }
  return [
    {
      title: t('colStatus'),
      key: 'status',
      dataIndex: 'status',
      width: 108,
      render: (status: JobStatus) => (
        <Tag color={statusColor[status] ?? statusColor.cancelled} className="mr-0">
          {status === 'running' && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
          {t(`jobStatus.${status}`)}
        </Tag>
      ),
    },
    {
      title: t('colProgress'),
      key: 'progress',
      width: 220,
      render: (_, job) => {
        if (job.status === 'running') {
          const percent = typeof job.progress.percent === 'number' ? job.progress.percent : null
          return (
            <div className="min-w-[180px]">
              <div className="mb-1 text-slate-500">{getProgress(job)}</div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-blue-500 transition-all duration-500"
                  style={{ width: `${percent ?? 20}%` }}
                />
              </div>
            </div>
          )
        }
        if (job.status === 'failed' && job.error) {
          return (
            <span className="text-red-600 line-clamp-2" title={job.error}>
              {job.error}
            </span>
          )
        }
        if (job.status === 'succeeded') {
          return <span className="text-green-600">{t('dataReady')}</span>
        }
        if (job.status === 'pending') {
          return <span className="text-slate-400">{t('waitingWorker')}</span>
        }
        return <span className="text-slate-400">—</span>
      },
    },
    {
      title: t('colSubmitted'),
      key: 'createdAt',
      dataIndex: 'createdAt',
      width: 120,
      render: (createdAt: string) => <span className="text-slate-500">{formatRelativeTime(createdAt)}</span>,
    },
    {
      title: t('colReferenceDate'),
      key: 'referenceDate',
      width: 120,
      render: (_, job) => <span className="text-slate-600">{getReferenceDate(job)}</span>,
    },
    {
      title: t('colStations'),
      key: 'stations',
      width: 80,
      render: (_, job) => {
        const codes = getStationCodes(job)
        const names = codes.map((code) => stationNameMap[code] ?? code)
        return <span className="text-slate-600" title={names.join('、')}>{names.length > 0 ? names.join('、') : '—'}</span>
      },
    },
    {
      title: t('colComplaintWindow'),
      key: 'dateRange',
      width: 210,
      render: (_, job) => <span className="text-slate-500">{getDateRangeLabel(job)}</span>,
    },
    {
      title: t('colMetrics'),
      key: 'metricKeys',
      width: 200,
      render: (_, job) => <MetricKeysCell job={job} />,
    },
    {
      title: t('colFinished'),
      key: 'finishedAt',
      dataIndex: 'finishedAt',
      width: 120,
      render: (finishedAt: string | null) =>
        finishedAt ? (
          <span className="text-slate-500">{formatRelativeTime(finishedAt)}</span>
        ) : (
          <span className="text-slate-300">—</span>
        ),
    },
    {
      title: tc('actions'),
      key: 'actions',
      width: 340,
      fixed: 'right',
      render: (_, job) => {
        const isLoadingThis = loadingJobId === job.id
        const isLoadingOther = loadingJobId != null && !isLoadingThis
        return (
          <div className="flex flex-wrap gap-2">
            {job.status === 'succeeded' && (
              <Button
                type="primary"
                loading={isLoadingThis}
                disabled={isLoadingOther}
                onClick={() => onLoadResults(job.id)}
              >
                {isLoadingThis ? tc('loadingEllipsis') : t('viewData')}
              </Button>
            )}
            {job.status === 'failed' && (
              <Button
                disabled={isLoadingOther}
                onClick={() => onRetry(job)}
                className="!border-orange-300 !bg-orange-50 !text-orange-700 hover:!bg-orange-100"
              >
                {t('resubmit')}
              </Button>
            )}
            {job.status === 'pending' && (
              <Button disabled={isLoadingOther} onClick={() => onCancel(job.id)}>{tc('cancel')}</Button>
            )}
            <Button
              disabled={isLoadingOther}
              onClick={() => onEdit(job)}
              title={t('editJobTooltip')}
            >
              {tc('edit')}
            </Button>
            {onShare && job.status === 'succeeded' && (
              <Button
                disabled={isLoadingOther}
                onClick={() => onShare(job)}
                title={t('shareJobTooltip')}
              >
                {tc('share')}
              </Button>
            )}
            <Button
              danger
              disabled={job.status === 'running' || isLoadingOther}
              onClick={() => onDelete(job.id)}
              title={job.status === 'running' ? t('deleteRunning') : undefined}
            >
              {tc('delete')}
            </Button>
          </div>
        )
      },
    },
  ]
}

export function VendorJobsTabContent({ jobs, isLoading, loadingJobId, onRefresh, onLoadResults, onEdit, onShare, onCancel, onDelete, onRetry, stationNameMap, headerAction }: Props) {
  const { t } = useTranslation('vendorAnalysis')
  const { t: tc } = useTranslation('common')
  const formatRelativeTime = useRelativeTimeFormatter()
  const activeCount = jobs.filter((j) => j.status === 'pending' || j.status === 'running').length
  const stationMap = useMemo(() => stationNameMap ?? {}, [stationNameMap])
  const columns = useMemo(
    () => buildColumns(t, tc, formatRelativeTime, loadingJobId, onLoadResults, onEdit, onShare, onCancel, onDelete, onRetry, stationMap),
    [t, tc, formatRelativeTime, loadingJobId, onLoadResults, onEdit, onShare, onCancel, onDelete, onRetry, stationMap],
  )

  return (
    <div className="space-y-4">
      <div className="admin-panel p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-950">{t('jobsTitle')}</h3>
          </div>
          <div className="flex items-center gap-3">
            {activeCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                <Play className="h-3 w-3" />
                {t('jobsActive', { count: activeCount })}
              </span>
            )}
            <button
              type="button"
              onClick={onRefresh}
              disabled={isLoading}
              className="admin-btn border border-slate-300 bg-white text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
              {tc('refresh')}
            </button>
            {headerAction}
          </div>
        </div>
      </div>

      <div className="admin-panel overflow-hidden">
        <Table<PublicJob>
          rowKey="id"
          loading={isLoading}
          columns={columns}
          dataSource={jobs}
          pagination={{
            pageSize: 20,
            showSizeChanger: true,
            showTotal: (total) => tc('tableTotal', { total }),
          }}
          locale={{ emptyText: t('jobsEmpty') }}
          scroll={{ x: 1440 }}
        />
      </div>
    </div>
  )
}
