import { Button, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { Loader2, Play, RefreshCw } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { JobStatus, PublicJob } from '../orderExceptionApi'

type Props = {
  jobs: PublicJob[]
  isLoading: boolean
  onRefresh: () => void
  onLoadResults: (jobId: string) => void
  onCancel: (jobId: string) => void
  onDelete: (jobId: string) => void
  onRetry: (job: PublicJob) => void
}

function getOrderNos(job: PublicJob): string[] {
  return Array.isArray(job.payload.orderNos) ? (job.payload.orderNos as string[]) : []
}

function getAiProvider(job: PublicJob): string {
  const p = job.payload.aiProvider
  if (p === 'openai') return 'OpenAI'
  return 'DeepSeek'
}

function getProgress(job: PublicJob): string {
  const p = job.progress
  const phase = typeof p.phase === 'string' ? p.phase : ''
  const message = typeof p.message === 'string' ? p.message : ''
  const percent = typeof p.percent === 'number' ? `${p.percent}%` : ''
  return [phase && `[${phase}]`, message, percent].filter(Boolean).join(' ') || '—'
}

function buildColumns(
  t: (key: string, options?: Record<string, unknown>) => string,
  tc: (key: string) => string,
  formatRelativeTime: (isoString: string) => string,
  onLoadResults: (jobId: string) => void,
  onCancel: (jobId: string) => void,
  onDelete: (jobId: string) => void,
  onRetry: (job: PublicJob) => void,
): ColumnsType<PublicJob> {
  const statusCfg: Record<
    JobStatus,
    { labelKey: string; color: 'warning' | 'processing' | 'success' | 'error' | 'default' }
  > = {
    pending: { labelKey: 'jobs.statusPending', color: 'warning' },
    running: { labelKey: 'jobs.statusRunning', color: 'processing' },
    succeeded: { labelKey: 'jobs.statusSucceeded', color: 'success' },
    failed: { labelKey: 'jobs.statusFailed', color: 'error' },
    cancelled: { labelKey: 'jobs.statusCancelled', color: 'default' },
  }

  return [
    {
      title: t('jobs.status'),
      key: 'status',
      dataIndex: 'status',
      width: 108,
      render: (status: JobStatus) => {
        const cfg = statusCfg[status] ?? statusCfg.cancelled
        return (
          <Tag color={cfg.color} className="mr-0">
            {status === 'running' && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
            {t(cfg.labelKey)}
          </Tag>
        )
      },
    },
    {
      title: t('jobs.submittedAt'),
      key: 'createdAt',
      dataIndex: 'createdAt',
      width: 120,
      render: (createdAt: string) => <span className="text-slate-500">{formatRelativeTime(createdAt)}</span>,
    },
    {
      title: t('jobs.orderCount'),
      key: 'orderCount',
      width: 88,
      render: (_, job) => <span className="tabular-nums">{getOrderNos(job).length}</span>,
    },
    {
      title: t('jobs.model'),
      key: 'aiProvider',
      width: 100,
      render: (_, job) => <span className="text-slate-600">{getAiProvider(job)}</span>,
    },
    {
      title: t('jobs.progress'),
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
          return <span className="text-green-600">{t('jobs.analyzeComplete')}</span>
        }
        if (job.status === 'pending') {
          return <span className="text-slate-400">{t('jobs.waitingWorker')}</span>
        }
        return <span className="text-slate-400">—</span>
      },
    },
    {
      title: t('jobs.finishedAt'),
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
      width: 220,
      fixed: 'right',
      render: (_, job) => (
        <div className="flex flex-wrap gap-2">
          {job.status === 'succeeded' && (
            <Button type="primary" onClick={() => onLoadResults(job.id)}>
              {t('jobs.loadResults')}
            </Button>
          )}
          {job.status === 'failed' && (
            <Button onClick={() => onRetry(job)} className="!border-orange-300 !bg-orange-50 !text-orange-700 hover:!bg-orange-100">
              {t('jobs.resubmit')}
            </Button>
          )}
          {job.status === 'pending' && (
            <Button onClick={() => onCancel(job.id)}>{tc('cancel')}</Button>
          )}
          <Button
            danger
            disabled={job.status === 'running'}
            onClick={() => onDelete(job.id)}
            title={job.status === 'running' ? t('jobs.cannotDeleteRunning') : undefined}
          >
            {tc('delete')}
          </Button>
        </div>
      ),
    },
  ]
}

export function JobsTabContent({ jobs, isLoading, onRefresh, onLoadResults, onCancel, onDelete, onRetry }: Props) {
  const { t } = useTranslation('orderException')
  const { t: tc } = useTranslation('common')

  const formatRelativeTime = useMemo(
    () => (isoString: string) => {
      const diffMs = Date.now() - new Date(isoString).getTime()
      const diffMin = Math.floor(diffMs / 60_000)
      if (diffMin < 1) return t('jobs.relativeJustNow')
      if (diffMin < 60) return t('jobs.relativeMinutesAgo', { count: diffMin })
      const diffHr = Math.floor(diffMin / 60)
      if (diffHr < 24) return t('jobs.relativeHoursAgo', { count: diffHr })
      return t('jobs.relativeDaysAgo', { count: Math.floor(diffHr / 24) })
    },
    [t],
  )

  const activeCount = jobs.filter((j) => j.status === 'pending' || j.status === 'running').length
  const columns = useMemo(
    () => buildColumns(t, tc, formatRelativeTime, onLoadResults, onCancel, onDelete, onRetry),
    [t, tc, formatRelativeTime, onLoadResults, onCancel, onDelete, onRetry],
  )

  return (
    <div className="space-y-4">
      <div className="admin-panel p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-950">{t('jobs.title')}</h3>
            <p className="mt-0.5 text-xs text-slate-500">{t('jobs.description')}</p>
          </div>
          <div className="flex items-center gap-3">
            {activeCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                <Play className="h-3 w-3" />
                {t('jobs.activeCount', { count: activeCount })}
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
            showTotal: (total) => t('jobs.paginationTotal', { total }),
          }}
          locale={{ emptyText: t('jobs.empty') }}
          scroll={{ x: 976 }}
        />
      </div>
    </div>
  )
}
