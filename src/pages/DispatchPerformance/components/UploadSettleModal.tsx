import { useEffect, useState } from 'react'
import { App, Alert, Button, DatePicker, Modal, Upload } from 'antd'
import type { UploadFile } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { Copy, UploadCloud } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { copyTextToClipboard } from '../../../utils/clipboard'
import { postUploadSettle, UploadCoverageError } from '../dispatchPerformanceApi'
import type { DispatchPerformanceConfig } from '../dispatchPerformanceTypes'
import { parseWaybillExports } from '../parseWaybillExport'

type Props = {
  config: DispatchPerformanceConfig | null
  onClose: () => void
  /** 作业已入队，交给 useSettleNow 轮询并弹出结果 */
  onEnqueued: (configId: string, jobId: string) => void
}

/**
 * 上传运单表结算：iMile 拦截 searchWaybill 时，用「中心运单查询」导出的表格补某个到件日。
 * 覆盖率不足由后端拒绝并带回缺失单号，这里提供一键复制，去门户按单号补导后连同原表一起重新上传。
 */
export function UploadSettleModal({ config, onClose, onEnqueued }: Props) {
  const { t } = useTranslation('dispatchPerformance')
  const { message } = App.useApp()

  const [date, setDate] = useState<Dayjs>(dayjs().subtract(2, 'day'))
  const [files, setFiles] = useState<UploadFile[]>([])
  const [error, setError] = useState<string | null>(null)
  const [missing, setMissing] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!config) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDate(dayjs().subtract(2, 'day'))
    setFiles([])
    setError(null)
    setMissing([])
  }, [config])

  const handleSubmit = async () => {
    if (!config) return
    const raw = files.map((f) => f.originFileObj).filter((f): f is NonNullable<typeof f> => f != null)
    if (raw.length === 0) return setError(t('uploadSettle.noFile'))

    setSubmitting(true)
    setError(null)
    setMissing([])
    try {
      const records = await parseWaybillExports(raw)
      const { job } = await postUploadSettle(config.id, {
        arrivalDate: date.format('YYYY-MM-DD'),
        records,
      })
      onEnqueued(config.id, job.id)
      onClose()
    } catch (err) {
      if (err instanceof UploadCoverageError) setMissing(err.missingWaybillNos)
      setError(err instanceof Error ? err.message : t('toast.unknownError'))
    } finally {
      setSubmitting(false)
    }
  }

  const copyMissing = async () => {
    const ok = await copyTextToClipboard(missing.join('\n'))
    if (ok) message.success(t('uploadSettle.copied', { count: missing.length }))
    else message.error(t('uploadSettle.copyFailed'))
  }

  return (
    <Modal
      open={config != null}
      onCancel={onClose}
      title={t('uploadSettle.title', { station: config?.stationName || config?.stationCode })}
      destroyOnHidden
      width={560}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={submitting}>
            {t('exception.cancel')}
          </Button>
          <Button type="primary" onClick={() => void handleSubmit()} loading={submitting}>
            {t('uploadSettle.submit')}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 pt-2">
        <p className="text-xs leading-relaxed text-slate-500">{t('uploadSettle.description')}</p>
        <div className="space-y-1">
          <div className="text-xs font-medium text-slate-500">{t('uploadSettle.fieldDate')}</div>
          <DatePicker
            value={date}
            onChange={(val) => val && setDate(val)}
            allowClear={false}
            className="w-full"
            disabled={submitting}
            disabledDate={(d) => d.isAfter(dayjs(), 'day')}
          />
        </div>
        <Upload.Dragger
          multiple
          accept=".xlsx,.xls"
          fileList={files}
          beforeUpload={() => false}
          onChange={({ fileList }) => setFiles(fileList)}
          disabled={submitting}
        >
          <div className="flex flex-col items-center gap-1 py-2 text-sm text-slate-500">
            <UploadCloud className="h-6 w-6 text-[var(--admin-accent)]" aria-hidden />
            {t('uploadSettle.dropHint')}
          </div>
        </Upload.Dragger>
        {error ? (
          <Alert
            type="error"
            showIcon
            message={error}
            action={
              missing.length > 0 ? (
                <Button icon={<Copy className="h-4 w-4" />} onClick={() => void copyMissing()}>
                  {t('uploadSettle.copyMissing', { count: missing.length })}
                </Button>
              ) : null
            }
          />
        ) : null}
      </div>
    </Modal>
  )
}
