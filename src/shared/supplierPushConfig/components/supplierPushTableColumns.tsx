import { Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { SupplierPushConfig } from '../types'
import { supplierDisplayName, truncateSupplierFieldMid } from '../display'

export function buildSupplierPushCatalogColumns(options?: {
  webhookMaxWidth?: string
}): ColumnsType<SupplierPushConfig> {
  const webhookMax = options?.webhookMaxWidth ?? 'min(280px,35vw)'
  return [
    {
      title: '供应商',
      key: 'vendor',
      width: 220,
      render: (_, row) => (
        <div>
          <div className="font-medium text-slate-800">{supplierDisplayName(row)}</div>
          <div className="text-xs text-slate-400">{row.vendorCode}</div>
        </div>
      ),
    },
    {
      title: '路由码',
      dataIndex: 'routeCode',
      key: 'routeCode',
      width: 140,
      render: (code: string) =>
        code ? (
          <Tooltip title={code}>
            <span className="block max-w-[120px] truncate font-mono text-xs text-slate-700">{code}</span>
          </Tooltip>
        ) : (
          <span className="text-slate-400">—</span>
        ),
    },
    {
      title: 'Webhook',
      dataIndex: 'webhookUrl',
      key: 'webhookUrl',
      render: (url: string) =>
        url ? (
          <Tooltip title={url}>
            <span
              className="block font-mono text-xs text-slate-600"
              style={{ maxWidth: webhookMax }}
            >
              {truncateSupplierFieldMid(url, 48)}
            </span>
          </Tooltip>
        ) : (
          <span className="text-amber-600">未配置</span>
        ),
    },
  ]
}
