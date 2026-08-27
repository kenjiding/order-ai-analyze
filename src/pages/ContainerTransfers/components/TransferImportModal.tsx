/**
 * 流转记录批量导入弹窗。
 *
 * 流程：下载模板 → 选文件 → 本地解析并逐行校验 → 预览 → 全部合法才允许提交。
 * 不做「跳过错误行只导正确行」：整批一个事务，漏行不易察觉，宁可让用户改完重传。
 */
import { useState } from 'react'
import { Alert, Button, Modal, Table, Tag, Upload } from 'antd'
import type { UploadFile } from 'antd/es/upload/interface'
import { Download, FileSpreadsheet } from 'lucide-react'
import { transferKindLabel } from '../../../containerManagement/constants'
import type { TransferCreateItem } from '../../../containerManagement/api'
import type { ContainerAccount } from '../../../containerManagement/types'
import { TRANSFER_IMPORT_MAX_ROWS } from '../transferImportTemplate'
import {
  parseTransferImportFile,
  type TransferImportRow,
} from '../transferImportParse'

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

  // 错误行排前面，用户不用在几十行里翻着找
  const sortedRows = rows
    ? [...rows].sort((a, b) => {
        const diff = (b.errors.length > 0 ? 1 : 0) - (a.errors.length > 0 ? 1 : 0)
        return diff !== 0 ? diff : a.rowNo - b.rowNo
      })
    : []

  return (
    <Modal
      title="批量上传流转记录"
      open={open}
      onCancel={handleCancel}
      destroyOnHidden
      width={960}
      styles={{ body: { background: 'var(--admin-bg, #f7fbff)', padding: '16px 24px' } }}
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-slate-500">
            整批一个事务：任何一行不合法都不会写入，改完重新上传即可。
          </span>
          <div className="flex gap-2">
            <Button onClick={handleCancel} disabled={submitting}>
              取消
            </Button>
            <Button
              type="primary"
              loading={submitting}
              disabled={!rows || errorCount > 0 || validCount === 0}
              onClick={() => void handleOk()}
            >
              确认导入 {validCount} 条
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <Alert
          type="info"
          showIcon
          message="填写要求"
          description={
            <ul className="ml-4 list-disc space-y-1 text-sm text-slate-700">
              <li>一行 = 一条流转记录；「大篮筐数量」「银框数量」至少填一个，留空表示不含该品类。</li>
              <li>「业务类型」「转出方」「接收方」必须用模板里的下拉选择，手打的站点名对不上系统账户。</li>
              <li>单次最多导入 {TRANSFER_IMPORT_MAX_ROWS} 行；日期留空按当天算。</li>
              <li>批量导入不会发送飞书通知，导入后请另行告知接收方前来确认。</li>
            </ul>
          }
        />

        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--admin-line)] bg-white px-4 py-3">
          <Button
            icon={<Download className="h-4 w-4" aria-hidden />}
            loading={templateDownloading}
            onClick={onDownloadTemplate}
          >
            下载模板
          </Button>
          <Upload
            accept=".xlsx,.xls,.csv"
            maxCount={1}
            fileList={fileList}
            beforeUpload={() => false}
            onChange={({ fileList: next }) => {
              setFileList(next.slice(-1))
              const file = next.at(-1)?.originFileObj
              if (file) void handleFile(file as File)
              else reset()
            }}
            onRemove={() => {
              reset()
              return true
            }}
          >
            <Button
              type="primary"
              icon={<FileSpreadsheet className="h-4 w-4" aria-hidden />}
              loading={parsing}
            >
              选择文件
            </Button>
          </Upload>
          <span className="text-xs text-slate-500">支持 .xlsx / .xls / .csv</span>
        </div>

        {error ? <Alert type="error" showIcon message={error} /> : null}

        {rows ? (
          <>
            <Alert
              type={errorCount > 0 ? 'error' : 'success'}
              showIcon
              message={
                errorCount > 0
                  ? `共 ${rows.length} 行，${errorCount} 行有问题，修正后重新上传`
                  : `共 ${rows.length} 行，全部校验通过`
              }
            />
            <Table<TransferImportRow>
              rowKey={(row) => row.rowNo}
              dataSource={sortedRows}
              pagination={{ pageSize: 10, showSizeChanger: false }}
              scroll={{ x: 900 }}
              rowClassName={(row) => (row.errors.length > 0 ? 'bg-rose-50/60' : '')}
              columns={[
                { title: '行号', dataIndex: 'rowNo', width: 70 },
                { title: '日期', width: 110, render: (_, row) => row.raw.occurredAt || '（当天）' },
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
          </>
        ) : null}
      </div>
    </Modal>
  )
}
