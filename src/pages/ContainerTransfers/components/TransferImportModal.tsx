/**
 * 流转记录批量导入弹窗。
 *
 * 流程：下载模板 → 选文件 → 本地解析并逐行校验 → 预览 → 全部合法才允许提交。
 * 不做「跳过错误行只导正确行」：整批一个事务，漏行不易察觉，宁可让用户改完重传。
 */
import { useState } from 'react'
import { Button, Modal, Table, Tag, Upload } from 'antd'
import type { UploadFile } from 'antd/es/upload/interface'
import { CircleAlert, CircleCheck, Download, FileSpreadsheet, Loader2, Upload as UploadIcon } from 'lucide-react'
import { transferKindLabel } from '../../../containerManagement/constants'
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
  ownAccounts: ContainerAccount[]
  counterparties: ContainerAccount[]
  submitting: boolean
  templateDownloading: boolean
  onDownloadTemplate: () => void
  onCancel: () => void
  onSubmit: (items: TransferCreateItem[], rowNos: number[]) => Promise<boolean>
}

function Metric({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: number
  tone?: 'neutral' | 'ok' | 'bad'
}) {
  const valueClass =
    tone === 'ok'
      ? 'text-[#1f6f68]'
      : tone === 'bad'
        ? 'text-rose-600'
        : 'text-slate-900'

  return (
    <div className="px-4 py-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums leading-none ${valueClass}`}>{value}</div>
    </div>
  )
}

export function TransferImportModal({
  open,
  ownAccounts,
  counterparties,
  submitting,
  templateDownloading,
  onDownloadTemplate,
  onCancel,
  onSubmit,
}: Props) {
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
    const result = await parseTransferImportFile(file, { ownAccounts, counterparties })
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
    ? '正在解析并校验文件…'
    : !rows
      ? '整批一个事务：任何一行不合法都不会写入。'
      : errorCount > 0
        ? `有 ${errorCount} 行需要修正，改完后重新上传。`
        : validCount === 0
          ? '没有可导入的记录。'
          : `共 ${validCount} 条全部通过，确认后一次性写入，并向双方联系人各推送一条汇总通知。`

  return (
    <Modal
      className="transfer-import-modal"
      title="批量上传流转记录"
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
              取消
            </Button>
            <Button
              type="primary"
              loading={submitting}
              disabled={!canSubmit}
              onClick={() => void handleOk()}
            >
              {validCount > 0 ? `确认导入 ${validCount} 条` : '确认导入'}
            </Button>
          </div>
        </div>
      }
    >
      {hasFile ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--admin-line)] bg-white px-4 py-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--admin-accent-soft)] text-[#1f6f68]">
              {parsing ? (
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
              ) : error ? (
                <CircleAlert className="h-5 w-5 text-rose-600" aria-hidden />
              ) : (
                <FileSpreadsheet className="h-5 w-5" aria-hidden />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-slate-900">{fileName}</div>
              <div className="mt-0.5 text-xs text-slate-500">
                {parsing
                  ? '正在校验每一行…'
                  : error
                    ? '无法解析，请更换文件'
                    : rows
                      ? `已读取 ${rows.length} 行`
                      : '等待校验'}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                icon={<Download className="h-4 w-4" aria-hidden />}
                loading={templateDownloading}
                disabled={parsing || submitting}
                onClick={onDownloadTemplate}
              >
                下载模板
              </Button>
              <Upload {...uploadProps}>
                <Button disabled={parsing || submitting}>更换文件</Button>
              </Upload>
              <Button disabled={parsing || submitting} onClick={reset}>
                移除
              </Button>
            </div>
          </div>

          {error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-relaxed text-rose-800">
              {error}
            </div>
          ) : null}

          {rows ? (
            <>
              <div className="grid grid-cols-3 divide-x divide-[var(--admin-line)] overflow-hidden rounded-xl border border-[var(--admin-line)] bg-white">
                <Metric label="全部行" value={rows.length} />
                <Metric label="校验通过" value={validCount} tone={errorCount === 0 ? 'ok' : 'neutral'} />
                <Metric label="需要修正" value={errorCount} tone={errorCount > 0 ? 'bad' : 'ok'} />
              </div>

              <section className="transfer-import-preview overflow-hidden rounded-xl border border-[var(--admin-line)] bg-white">
                <header className="flex items-center justify-between gap-3 border-b border-[var(--admin-line)] bg-[var(--admin-surface-soft)] px-4 py-2.5">
                  <span className="text-sm font-semibold text-slate-800">校验预览</span>
                  {errorCount > 0 ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-rose-600">
                      <CircleAlert className="h-3.5 w-3.5" aria-hidden />
                      问题行已置顶
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs text-[#1f6f68]">
                      <CircleCheck className="h-3.5 w-3.5" aria-hidden />
                      全部通过
                    </span>
                  )}
                </header>
                <Table<TransferImportRow>
                  rowKey={(row) => row.rowNo}
                  dataSource={sortedRows}
                  pagination={{ pageSize: 10, showSizeChanger: false }}
                  scroll={{ x: 900 }}
                  rowClassName={(row) => (row.errors.length > 0 ? 'bg-rose-50/60' : '')}
                  columns={[
                    { title: '行号', dataIndex: 'rowNo', width: 70 },
                    {
                      title: '日期',
                      width: 110,
                      render: (_, row) => row.raw.occurredAt || '（当天）',
                    },
                    {
                      title: '业务类型',
                      width: 90,
                      render: (_, row) => (row.item ? transferKindLabel[row.item.kind] : row.raw.kind),
                    },
                    { title: '转出方', width: 140, render: (_, row) => row.raw.from },
                    { title: '接收方', width: 140, render: (_, row) => row.raw.to },
                    { title: '大篮筐', width: 80, render: (_, row) => row.raw.bigBasket || '—' },
                    { title: '银框', width: 80, render: (_, row) => row.raw.silverBox || '—' },
                    {
                      title: '备注',
                      width: 160,
                      render: (_, row) => (
                        <span className="line-clamp-2 text-slate-600">{row.raw.note || '—'}</span>
                      ),
                    },
                    {
                      title: '校验结果',
                      width: 260,
                      render: (_, row) =>
                        row.errors.length === 0 ? (
                          <Tag color="green">通过</Tag>
                        ) : (
                          <div className="space-y-1">
                            {row.errors.map((message) => (
                              <Tag key={message} color="red" className="whitespace-normal">
                                {message}
                              </Tag>
                            ))}
                          </div>
                        ),
                    },
                  ]}
                />
              </section>
            </>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(16rem,18rem)_minmax(0,1fr)]">
          <aside className="flex flex-col justify-between rounded-xl border border-[var(--admin-line)] bg-white p-5">
            <div>
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--admin-sky-soft)] text-[#25526e]">
                <Download className="h-5 w-5" aria-hidden />
              </div>
              <h3 className="mt-4 text-sm font-semibold text-slate-900">先下载模板</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-500">
                业务类型、转出方、接收方请用表内下拉。手打的站点名对不上系统账户。
              </p>
            </div>
            <Button
              className="mt-5"
              icon={<Download className="h-4 w-4" aria-hidden />}
              loading={templateDownloading}
              onClick={onDownloadTemplate}
              block
            >
              下载模板
            </Button>
          </aside>

          <Upload.Dragger {...uploadProps} className="transfer-import-dropzone">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--admin-accent-soft)] text-[#1f6f68]">
              <UploadIcon className="h-5 w-5" aria-hidden />
            </div>
            <p className="mt-4 text-sm font-semibold text-slate-900">将文件拖到此处，或点击选择</p>
            <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
              支持 .xlsx / .xls / .csv，单次最多 {TRANSFER_IMPORT_MAX_ROWS} 行
            </p>
          </Upload.Dragger>
        </div>
      )}
    </Modal>
  )
}
