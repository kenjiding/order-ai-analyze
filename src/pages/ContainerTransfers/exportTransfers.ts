/** 流转记录导出明细：按当前筛选条件取全量数据（服务端单次最多 200 条，需翻页汇总），再按品类展开为明细行 */
import { saveAs } from 'file-saver'
import type { TFunction } from 'i18next'
import * as XLSX from 'xlsx-js-style'
import { applySheetCenterAlignment } from '../../utils/xlsxCenteredSheet'
import { fetchTransfers } from '../../containerManagement/api'
import { formatTransferNo, parseTransferNo } from '../../containerManagement/constants'
import type { Transfer } from '../../containerManagement/types'
import { showToast } from '../../utils/toast'
import type { TransferFilters } from './useContainerTransfersPage'

const EXPORT_PAGE_SIZE = 200
const COLUMN_WIDTHS = [12, 12, 10, 12, 16, 16, 16, 10, 10, 10, 10, 24]

function timestamp(): string {
  return new Date().toISOString().replace(/\D/g, '').slice(0, 14)
}

async function fetchAllTransfers(filters: TransferFilters): Promise<Transfer[] | null> {
  const query = {
    transferId: parseTransferNo(filters.transferId) ?? undefined,
    fromAccountId: filters.fromAccountIds.join(',') || undefined,
    toAccountId: filters.toAccountIds.join(',') || undefined,
    status: filters.statuses.join(',') || undefined,
    start: filters.range?.[0].format('YYYY-MM-DD'),
    end: filters.range?.[1].format('YYYY-MM-DD'),
  }
  const all: Transfer[] = []
  let page = 1
  for (;;) {
    const res = await fetchTransfers({ ...query, page, pageSize: EXPORT_PAGE_SIZE })
    if (!res.ok) return null
    all.push(...res.data.items)
    if (all.length >= res.data.total || res.data.items.length === 0) break
    page += 1
  }
  return all
}

export async function exportTransfersToXlsx(
  filters: TransferFilters,
  t: TFunction<'container'>,
): Promise<void> {
  const transfers = await fetchAllTransfers(filters)
  if (transfers === null) {
    showToast(t('transfers.exportFailed'), 'error')
    return
  }
  if (transfers.length === 0) {
    showToast(t('transfers.exportEmpty'), 'error')
    return
  }
  const data = transfers.flatMap((transfer) =>
    transfer.items.map((item) => ({
      [t('transfers.colTime')]: transfer.occurredAt,
      [t('transfers.colNo')]: formatTransferNo(transfer.id),
      [t('transfers.colKind')]: t(`transferKind.${transfer.kind}`),
      [t('transfers.colStatus')]: t(`transferStatus.${transfer.status}`),
      [t('transfers.colFrom')]: transfer.fromAccountName,
      [t('transfers.colTo')]: transfer.toAccountName,
      [t('transfers.colCreatedAt')]: new Date(transfer.createdAt).toLocaleString(),
      [t('transfers.exportColType')]: t(`containerType.${item.containerType}`),
      [t('transfers.exportColDeclared')]: item.declaredQuantity,
      [t('transfers.exportColReceived')]: item.receivedQuantity ?? '',
      [t('transfers.exportColSettled')]: item.settledQuantity ?? '',
      [t('transfers.colNote')]: transfer.note ?? '',
    })),
  )
  const ws = XLSX.utils.json_to_sheet(data)
  applySheetCenterAlignment(ws)
  ws['!cols'] = COLUMN_WIDTHS.map((wch) => ({ wch }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, t('transfers.exportSheetName'))
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true }) as ArrayBuffer
  saveAs(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `${t('transfers.exportFileNamePrefix')}${timestamp()}.xlsx`,
  )
}
