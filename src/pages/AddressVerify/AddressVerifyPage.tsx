import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import { Alert, Button, Input, Spin, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { MapPin, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { backendFetch } from '../../api/httpClient'
import { useAppSettings } from '../../context/AppSettingsContext'
import { parseOrderNumbersUnique } from '../../utils/orderNoInput'
import type { AddressVerifyMapPoint } from './AddressVerifyMapView'

/** maplibre-gl 体积较大，懒加载避免未用到地图的场景也被迫下载（做法与司机地图一致） */
const AddressVerifyMapView = lazy(() =>
  import('./AddressVerifyMapView').then((m) => ({ default: m.AddressVerifyMapView })),
)

const MAX_ORDERS = 200

type AddressVerifyStatus = 'match' | 'mismatch' | 'unresolved' | 'no_coordinate'

type AddressVerifyRow = {
  orderNo: string
  merchantName: string
  consigneeProvince: string
  consigneeCity: string
  consigneeAddress: string
  consigneeZipCode: string
  resolvedPostcode: string
  latitude: number | null
  longitude: number | null
  status: AddressVerifyStatus
  error: string
  auPostBlocked: boolean
  auPostReason: string
}

export default function AddressVerifyPage() {
  const { t } = useTranslation('addressVerify')
  const { imileToken } = useAppSettings()
  const [raw, setRaw] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [rows, setRows] = useState<AddressVerifyRow[]>([])

  const orderNos = useMemo(() => parseOrderNumbersUnique(raw), [raw])

  const mapPoints = useMemo<AddressVerifyMapPoint[]>(
    () =>
      rows
        .filter(
          (r): r is AddressVerifyRow & { latitude: number; longitude: number } =>
            r.latitude != null && r.longitude != null && r.status !== 'no_coordinate',
        )
        .map((r) => ({
          orderNo: r.orderNo,
          latitude: r.latitude,
          longitude: r.longitude,
          status: r.status as 'match' | 'mismatch' | 'unresolved',
          merchantName: r.merchantName,
          consigneeAddress: r.consigneeAddress,
          consigneeZipCode: r.consigneeZipCode,
          resolvedPostcode: r.resolvedPostcode,
        })),
    [rows],
  )

  const handleCheck = async () => {
    const token = imileToken.trim()
    if (!token) {
      setError(t('imileTokenRequired', { ns: 'common' }))
      return
    }
    if (!orderNos.length) {
      setError(t('noOrders'))
      return
    }
    if (orderNos.length > MAX_ORDERS) {
      setError(t('tooManyOrders', { max: MAX_ORDERS }))
      return
    }

    setLoading(true)
    setError('')
    try {
      const res = await backendFetch('/api/address-verify/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderNos, imileToken: token }),
      })
      const json = (await res.json()) as { ok?: boolean; rows?: AddressVerifyRow[]; error?: string }
      if (!res.ok || json.ok !== true) {
        setError(json.error || t('requestFailed'))
        setRows([])
        return
      }
      setRows(json.rows ?? [])
    } catch {
      setError(t('backendUnreachable'))
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  const statusTag = useCallback((status: AddressVerifyStatus) => {
    switch (status) {
      case 'match':
        return <Tag color="green">{t('statusMatch')}</Tag>
      case 'mismatch':
        return <Tag color="red">{t('statusMismatch')}</Tag>
      case 'no_coordinate':
        return <Tag>{t('statusNoCoordinate')}</Tag>
      default:
        return <Tag color="orange">{t('statusUnresolved')}</Tag>
    }
  }, [t])

  const columns: ColumnsType<AddressVerifyRow> = useMemo(
    () => [
      { title: t('colOrderNo'), dataIndex: 'orderNo', key: 'orderNo', width: 160, fixed: 'left' },
      { title: t('colMerchant'), dataIndex: 'merchantName', key: 'merchantName', width: 140 },
      { title: t('colProvince'), dataIndex: 'consigneeProvince', key: 'consigneeProvince', width: 110 },
      { title: t('colCity'), dataIndex: 'consigneeCity', key: 'consigneeCity', width: 120 },
      { title: t('colAddress'), dataIndex: 'consigneeAddress', key: 'consigneeAddress', ellipsis: true },
      { title: t('colZipCode'), dataIndex: 'consigneeZipCode', key: 'consigneeZipCode', width: 100 },
      {
        title: t('colResolvedPostcode'),
        dataIndex: 'resolvedPostcode',
        key: 'resolvedPostcode',
        width: 120,
        render: (value: string) => value || '—',
      },
      {
        title: t('colCoordinate'),
        key: 'coordinate',
        width: 180,
        render: (_, row) =>
          row.latitude != null && row.longitude != null
            ? `${row.latitude.toFixed(5)}, ${row.longitude.toFixed(5)}`
            : '—',
      },
      {
        title: t('colAuPost'),
        key: 'auPost',
        width: 140,
        render: (_, row) =>
          row.auPostBlocked ? (
            <Tag color="red" title={row.auPostReason}>
              {t('auPostBlocked')}
            </Tag>
          ) : (
            <span className="text-xs text-slate-400">—</span>
          ),
      },
      {
        title: t('colStatus'),
        key: 'status',
        width: 110,
        fixed: 'right',
        render: (_, row) => (
          <div className="flex flex-col gap-0.5">
            {statusTag(row.status)}
            {row.error ? <span className="text-xs text-slate-400">{row.error}</span> : null}
          </div>
        ),
      },
    ],
    [t, statusTag],
  )

  return (
    <div className="admin-page space-y-5">
      <header className="admin-panel p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#2f8f87]/15 text-[#1f6f68]">
            <MapPin className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-950">{t('title')}</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">{t('description')}</p>
          </div>
        </div>
      </header>

      <section className="admin-panel p-5 space-y-3">
        <Input.TextArea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={t('inputPlaceholder')}
          autoSize={{ minRows: 4, maxRows: 10 }}
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400">{t('orderCount', { count: orderNos.length })}</span>
          <Button
            type="primary"
            icon={<Search className="h-4 w-4" aria-hidden />}
            loading={loading}
            onClick={() => void handleCheck()}
          >
            {loading ? t('checking') : t('start')}
          </Button>
        </div>
        {error ? <Alert type="error" showIcon message={error} /> : null}
      </section>

      {mapPoints.length > 0 ? (
        <section className="admin-panel p-5">
          <Suspense
            fallback={
              <div className="flex items-center justify-center py-16">
                <Spin />
              </div>
            }
          >
            <AddressVerifyMapView points={mapPoints} />
          </Suspense>
        </section>
      ) : null}

      <section className="admin-panel overflow-hidden">
        <Table<AddressVerifyRow>
          rowKey="orderNo"
          columns={columns}
          dataSource={rows}
          loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          scroll={{ x: 1340 }}
          locale={{ emptyText: t('emptyText') }}
        />
      </section>
    </div>
  )
}
