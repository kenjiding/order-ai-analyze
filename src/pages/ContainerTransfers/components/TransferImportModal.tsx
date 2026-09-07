/**
 * 流转记录批量导入弹窗。
 *
 * 流程：下载模板 → 选文件 → 本地解析并逐行校验 → 预览 → 全部合法才允许提交。
 * 不做「跳过错误行只导正确行」：整批一个事务，漏行不易察觉，宁可让用户改完重传。
 */
import { useState } from 'react'
import { Button, Modal, Table, Upload } from 'antd'
import type { UploadFile } from 'antd/es/upload/interface'
import { CircleAlert, CircleCheck, Download, FileSpreadsheet, Loader2, Upload as UploadIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TransferCreateItem } from '../../../containerManagement/api'
import type { ContainerAccount } from '../../../containerManagement/types'
import { TRANSFER_IMPORT_MAX_ROWS } from '../transferImportTemplate'
import {
  parseTransferImportFile,
  type TransferImportRow,
} from '../transferImportParse'
import './TransferImportModal.css'

type Props = {
  open: boolean
  accounts: ContainerAccount[]
  /** 转出方的可选范围：本人绑定的站点 */
  fromAccounts: ContainerAccount[]
  submitting: boolean
  templateDownloading: boolean
  onDownloadTemplate: () => void
  onCancel: () => void
  onSubmit: (items: TransferCreateItem[], rowNos: number[]) => Promise<boolean>
}

export function TransferImportModal({
  open,
  accounts,
  fromAccounts,
  submitting,
  templateDownloading,
  onDownloadTemplate,
  onCancel,
  onSubmit,
}: Props) {
  const { t } = useTranslation('container')
  const { t: tc } = useTranslation('common')
  const [fileList, setFileList] = useState<UploadFile[]>([])
  const [rows, setRows] = useState<TransferImportRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [parsing, setParsing] = useState(false)

  const errorCount = rows?.filter((row) => row.errors.length > 0).length ?? 0
  const validCount = (rows?.length ?? 0) - errorCount
  const hasFile = fileList.length > 0
  const fileName = fileList[0]?.name ?? ''
  const canSubmit = Boolean(rows) && errorCount === 0 && validCount > 0

  const reset = () => {
    setFileList([])
    setRows(null)
    setError(null)
  }

  const handleFile = async (file: File) => {
    setParsing(true)
    setRows(null)
    setError(null)
    const result = await parseTransferImportFile(file, { accounts, fromAccounts })
    setParsing(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setRows(result.rows)
  }

  const handleOk = async () => {
    if (!rows || errorCount > 0) return
    const valid = rows.filter((row) => row.item !== null)
    if (valid.length === 0) return
    const done = await onSubmit(
      valid.map((row) => row.item as TransferCreateItem),
      valid.map((row) => row.rowNo),
    )
    if (done) reset()
  }

  const handleCancel = () => {
    reset()
    onCancel()
  }

  const uploadProps = {
    accept: '.xlsx,.xls,.csv',
    maxCount: 1,
    fileList,
    showUploadList: false,
    disabled: parsing || submitting,
    beforeUpload: () => false,
    onChange: ({ fileList: next }: { fileList: UploadFile[] }) => {
      const latest = next.slice(-1)
      setFileList(latest)
      const file = latest[0]?.originFileObj
      if (file) void handleFile(file as File)
      else reset()
    },
  }

  // 错误行排前面，用户不用在几十行里翻着找
  const sortedRows = rows
    ? [...rows].sort((a, b) => {
        const diff = (b.errors.length > 0 ? 1 : 0) - (a.errors.length > 0 ? 1 : 0)
        return diff !== 0 ? diff : a.rowNo - b.rowNo
      })
    : []

  const footerHint = parsing
    ? t('transfers.importParsing')
    : !rows
      ? t('transfers.importFooterDefault')
      : errorCount > 0
        ? t('transfers.importFooterErrors', { count: errorCount })
        : validCount === 0
          ? t('transfers.importFooterNoRows')
          : t('transfers.importFooterReady', { count: validCount })

  return (
    <Modal
      className="transfer-import-modal"
      title={t('transfers.importTitle')}
      open={open}
      onCancel={handleCancel}
      destroyOnHidden
      width={960}
      styles={{ body: { background: 'var(--admin-bg, #f7fbff)', padding: '16px 24px' } }}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="max-w-[36rem] text-sm text-slate-500">{footerHint}</span>
          <div className="flex gap-2">
            <Button onClick={handleCancel} disabled={submitting}>
              {tc('cancel')}
            </Button>
            <Button
              type="primary"
              loading={submitting}
              disabled={!canSubmit}
              onClick={() => void handleOk()}
            >
              {validCount > 0 ? t('transfers.importConfirmCount', { count: validCount }) : t('transfers.importConfirm')}
            </Button>
          </div>
        </div>
      }
    >
      {hasFile ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--admin-line)] bg-white px-4 py-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--admin-accent-soft)] text-[#1f6f68]">
              {parsing ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : error ? (
                <CircleAlert className="h-4 w-4 text-rose-600" aria-hidden />
              ) : (
                <FileSpreadsheet className="h-4 w-4" aria-hidden />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-slate-900">{fileName}</div>
              <div className="mt-0.5 text-xs text-slate-500">
                {parsing
                  ? t('transfers.importValidating')
                  : error
                    ? t('transfers.importParseFailed')
                    : rows
                      ? t('transfers.importRowsRead', { count: rows.length })
                      : t('transfers.importWaiting')}
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Upload {...uploadProps}>
                <Button disabled={parsing || submitting}>
                  {t('transfers.importReplaceFile')}
                </Button>
              </Upload>
              <Button disabled={parsing || submitting} onClick={reset}>
                {t('transfers.importRemoveFile')}
              </Button>
            </div>
          </div>

          {error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-relaxed text-rose-800">
              {error}
            </div>
          ) : null}

          {rows ? (
            <section className="transfer-import-preview overflow-hidden rounded-xl border border-[var(--admin-line)] bg-white">
              <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--admin-line)] bg-[var(--admin-surface-soft)] px-4 py-2.5">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold text-slate-800">{t('transfers.importPreviewTitle')}</span>
                  <span className="text-xs text-slate-500">{t('transfers.importPreviewTotal', { count: rows.length })}</span>
                </div>
                {errorCount > 0 ? (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-600">
                    <CircleAlert className="h-3.5 w-3.5" aria-hidden />
                    {t('transfers.importErrorsPinned', { count: errorCount })}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#1f6f68]">
                    <CircleCheck className="h-3.5 w-3.5" aria-hidden />
                    {t('transfers.importAllPassed')}
                  </span>
                )}
              </header>
              <Table<TransferImportRow>
                rowKey={(row) => row.rowNo}
                dataSource={sortedRows}
                pagination={rows.length > 10 ? { pageSize: 10, showSizeChanger: false } : false}
                scroll={{ x: 880 }}
                rowClassName={(row) => (row.errors.length > 0 ? 'bg-rose-50/60' : '')}
                columns={[
                  {
                    title: t('transfers.importColRow'),
                    dataIndex: 'rowNo',
                    width: 74,
                    render: (value: number) => (
                      <span className="tabular-nums text-slate-500">{value}</span>
                    ),
                  },
                  {
                    title: t('transfers.importColDate'),
                    width: 108,
                    render: (_, row) => row.raw.occurredAt || t('transfers.importTodayDefault'),
                  },
                  {
                    title: t('transfers.importColKind'),
                    width: 88,
                    render: (_, row) =>
                      row.item ? t(`transferKind.${row.item.kind}`) : row.raw.kind,
                  },
                  { title: t('transfers.importColFrom'), width: 132, render: (_, row) => row.raw.from },
                  { title: t('transfers.importColTo'), width: 132, render: (_, row) => row.raw.to },
                  {
                    title: t('transfers.importColBigBasket'),
                    width: 76,
                    render: (_, row) => (
                      <span className="tabular-nums">{row.raw.bigBasket || '-'}</span>
                    ),
                  },
                  {
                    title: t('transfers.importColSilverBox'),
                    width: 76,
                    render: (_, row) => (
                      <span className="tabular-nums">{row.raw.silverBox || '-'}</span>
                    ),
                  },
                  {
                    title: t('transfers.importColNote'),
                    width: 148,
                    render: (_, row) => (
                      <span className="line-clamp-2 text-slate-600">{row.raw.note || '-'}</span>
                    ),
                  },
                  {
                    title: t('transfers.importColResult'),
                    width: 248,
                    render: (_, row) =>
                      row.errors.length === 0 ? (
                        <span className="text-[#1f6f68]">{t('transfers.importPassed')}</span>
                      ) : (
                        <div className="space-y-1">
                          {row.errors.map((message) => (
                            <div key={message} className="text-rose-600">
                              {message}
                            </div>
                          ))}
                        </div>
                      ),
                  },
                ]}
              />
            </section>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--admin-line)] bg-white px-4 py-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-slate-900">{t('transfers.importDownloadFirst')}</div>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{t('transfers.importDownloadHint')}</p>
            </div>
            <Button
              icon={<Download className="h-4 w-4" aria-hidden />}
              loading={templateDownloading}
              onClick={onDownloadTemplate}
            >
              {t('transfers.importDownloadTemplate')}
            </Button>
          </div>

          <Upload.Dragger {...uploadProps} className="transfer-import-dropzone">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--admin-accent-soft)] text-[#1f6f68]">
              <UploadIcon className="h-5 w-5" aria-hidden />
            </div>
            <p className="mt-4 text-sm font-semibold text-slate-900">{t('transfers.importDropTitle')}</p>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
              {t('transfers.importDropHint', { max: TRANSFER_IMPORT_MAX_ROWS })}
            </p>
          </Upload.Dragger>
        </div>
      )}
    </Modal>
  )
}
