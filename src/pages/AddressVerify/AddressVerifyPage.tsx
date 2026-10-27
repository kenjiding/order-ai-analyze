import { lazy, Suspense, useCallback, useMemo, useState } from 'react'
import { Alert, Button, DatePicker, Input, Segmented, Select, Spin, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs, { type Dayjs } from 'dayjs'
import { CloudDownload, MapPin, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { backendFetch } from '../../api/httpClient'
import { useAppSettings } from '../../context/AppSettingsContext'
import { parseOrderNumbersUnique } from '../../utils/orderNoInput'
import { fetchFleetPendingSplitBox } from '../PushNotifications/fleetPendingSplitBoxApi'
import type { FleetScanRow } from '../PushNotifications/fleetSupplierPushTypes'
import type { AddressVerifyMapPoint } from './AddressVerifyMapView'
import { exportAddressVerifyTemplate } from './exportAddressVerifyTemplate'

/** maplibre-gl 体积较大，懒加载避免未用到地图的场景也被迫下载（做法与司机地图一致） */
const AddressVerifyMapView = lazy(() =>
  import('./AddressVerifyMapView').then((m) => ({ default: m.AddressVerifyMapView })),
)

const MAX_ORDERS = 500

type AddressVerifySourceMode = 'manual' | 'route'

type RouteCodeOption = { routeCode: string; count: number }

const PENDING_BOX_RANGE_PRESETS: Array<{ labelKey: string; months: number; days: number }> = [
  { labelKey: 'pendingRangePresetWeek', months: 0, days: 6 },
  { labelKey: 'pendingRangePresetMonth', months: 1, days: 0 },
  { labelKey: 'pendingRangePresetHalfYear', months: 6, days: 0 },
  { labelKey: 'pendingRangePresetYear', months: 12, days: 0 },
]

type AddressVerifyStatus = 'match' | 'mismatch' | 'unresolved' | 'no_coordinate'

type AddressVerifyRow = {
  orderNo: string
  merchantName: string
  consigneeProvince: string
  consigneeCity: string
  consigneeAddress: string
  consigneeZipCode: string
  resolvedPostcode: string
  resolvedCity: string
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
  const [mode, setMode] = useState<AddressVerifySourceMode>('manual')
  const [raw, setRaw] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [rows, setRows] = useState<AddressVerifyRow[]>([])

  const [pendingBoxRange, setPendingBoxRange] = useState<[Dayjs, Dayjs]>(() => [
    dayjs().subtract(6, 'day').startOf('day'),
    dayjs().endOf('day'),
  ])
  const [pendingBoxLoading, setPendingBoxLoading] = useState(false)
  const [pendingBoxSummary, setPendingBoxSummary] = useState('')
  const [scanRows, setScanRows] = useState<FleetScanRow[]>([])
  const [selectedRouteCodes, setSelectedRouteCodes] = useState<string[]>([])
  const [selectedOrderNos, setSelectedOrderNos] = useState<string[]>([])

  const orderNos = useMemo(() => parseOrderNumbersUnique(raw), [raw])

  const pendingBoxPresets = useMemo(
    () =>
      PENDING_BOX_RANGE_PRESETS.map(({ labelKey, months, days }) => ({
        label: t(labelKey),
        value: [
          months ? dayjs().subtract(months, 'month').startOf('day') : dayjs().subtract(days, 'day').startOf('day'),
          dayjs().endOf('day'),
        ] as [Dayjs, Dayjs],
      })),
    [t],
  )

  const routeCodeOptions = useMemo<RouteCodeOption[]>(() => {
    const ordersByRoute = new Map<string, Set<string>>()
    scanRows.forEach((row) => {
      if (!ordersByRoute.has(row.routeCode)) ordersByRoute.set(row.routeCode, new Set())
      ordersByRoute.get(row.routeCode)!.add(row.orderKey)
    })
    return [...ordersByRoute.entries()]
      .map(([routeCode, orderKeys]) => ({ routeCode, count: orderKeys.size }))
      .sort((a, b) => b.count - a.count || a.routeCode.localeCompare(b.routeCode))
  }, [scanRows])

  const routeMatchedOrderNos = useMemo(() => {
    if (!selectedRouteCodes.length) return []
    const selected = new Set(selectedRouteCodes)
    return [...new Set(scanRows.filter((row) => selected.has(row.routeCode)).map((row) => row.orderKey))]
  }, [scanRows, selectedRouteCodes])

  const effectiveOrderNos = mode === 'manual' ? orderNos : routeMatchedOrderNos

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

  const handleFetchPendingData = async () => {
    const [start, end] = pendingBoxRange
    setPendingBoxLoading(true)
    setError('')
    try {
      const res = await fetchFleetPendingSplitBox({
        startTime: start.format('YYYY-MM-DD HH:mm:ss'),
        endTime: end.format('YYYY-MM-DD HH:mm:ss'),
      })
      if (!res.ok) {
        setError(t('pendingBoxFetchFailed', { error: res.error }))
        return
      }
      if (!res.data.rows.length) {
        setError(t('pendingBoxNoValidRows'))
        setScanRows([])
        setPendingBoxSummary('')
        return
      }
      setScanRows(res.data.rows)
      setSelectedRouteCodes([])
      setPendingBoxSummary(
        t('pendingBoxFetchSuccess', { rowCount: res.data.rows.length, dropped: res.data.droppedRows }),
      )
    } finally {
      setPendingBoxLoading(false)
    }
  }

  const handleCheck = async () => {
    const token = imileToken.trim()
    if (!token) {
      setError(t('imileTokenRequired', { ns: 'common' }))
      return
    }
    if (mode === 'route' && !selectedRouteCodes.length) {
      setError(scanRows.length ? t('noRouteCodeSelected') : t('noRouteCodeData'))
      return
    }
    if (!effectiveOrderNos.length) {
      setError(t('noOrders'))
      return
    }
    if (effectiveOrderNos.length > MAX_ORDERS) {
      setError(t('tooManyOrders', { max: MAX_ORDERS }))
      return
    }

    setLoading(true)
    setError('')
    try {
      const res = await backendFetch('/api/address-verify/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderNos: effectiveOrderNos, imileToken: token }),
      })
      const json = (await res.json()) as { ok?: boolean; rows?: AddressVerifyRow[]; error?: string }
      if (!res.ok || json.ok !== true) {
        setError(json.error || t('requestFailed'))
        setRows([])
        return
      }
      setRows(json.rows ?? [])
      setSelectedOrderNos([])
    } catch {
      setError(t('backendUnreachable'))
      setRows([])
      setSelectedOrderNos([])
    } finally {
      setLoading(false)
    }
  }

  const handleExport = async () => {
    const selected = new Set(selectedOrderNos)
    const exportRows = rows
      .filter((row) => selected.has(row.orderNo))
      .map((row) => ({
        orderNo: row.orderNo,
        resolvedCity: row.resolvedCity,
        resolvedPostcode: row.resolvedPostcode,
      }))
    if (!exportRows.length) return
    await exportAddressVerifyTemplate(exportRows, {
      sheetName: t('exportSheetName'),
      fileNamePrefix: t('exportFileNamePrefix'),
    })
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
        title: t('colResolvedCity'),
        dataIndex: 'resolvedCity',
        key: 'resolvedCity',
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
        <Segmented
          value={mode}
          onChange={(value) => {
            setMode(value as AddressVerifySourceMode)
            setError('')
          }}
          options={[
            { label: t('modeManual'), value: 'manual' },
            { label: t('modeRoute'), value: 'route' },
          ]}
        />

        {mode === 'manual' ? (
          <Input.TextArea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={t('inputPlaceholder')}
            autoSize={{ minRows: 4, maxRows: 10 }}
          />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-500">{t('inboundTimeRangeLabel')}</span>
              <DatePicker.RangePicker
                value={pendingBoxRange}
                onChange={(vals) => {
                  if (vals && vals[0] && vals[1]) setPendingBoxRange([vals[0], vals[1]])
                }}
                presets={pendingBoxPresets}
                showTime={{ format: 'HH:mm' }}
                format="YYYY-MM-DD HH:mm"
                allowClear={false}
              />
              <Button
                icon={<CloudDownload className="h-4 w-4" aria-hidden />}
                loading={pendingBoxLoading}
                onClick={() => void handleFetchPendingData()}
              >
                {pendingBoxLoading ? t('fetchingPendingData') : t('fetchPendingData')}
              </Button>
              {pendingBoxSummary ? (
                <span className="text-xs text-slate-400">{pendingBoxSummary}</span>
              ) : null}
            </div>

            {routeCodeOptions.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  mode="multiple"
                  allowClear
                  className="w-80"
                  maxTagCount="responsive"
                  value={selectedRouteCodes}
                  onChange={setSelectedRouteCodes}
                  placeholder={t('routeCodeSelectPlaceholder')}
                  options={routeCodeOptions.map((o) => ({
                    label: t('routeCodeOptionLabel', { routeCode: o.routeCode, count: o.count }),
                    value: o.routeCode,
                  }))}
                />
                <Button
                  type="primary"
                  icon={<Search className="h-4 w-4" aria-hidden />}
                  loading={loading}
                  onClick={() => void handleCheck()}
                >
                  {loading ? t('analyzing') : t('startAnalyze')}
                </Button>
                <span className="text-xs text-slate-400">
                  {t('routeCodeMatchedCount', {
                    selected: selectedRouteCodes.length,
                    count: routeMatchedOrderNos.length,
                  })}
                </span>
              </div>
            ) : null}
          </div>
        )}

        {mode === 'manual' ? (
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">
              {t('orderCount', { count: effectiveOrderNos.length })}
            </span>
            <Button
              type="primary"
              icon={<Search className="h-4 w-4" aria-hidden />}
              loading={loading}
              onClick={() => void handleCheck()}
            >
              {loading ? t('checking') : t('start')}
            </Button>
          </div>
        ) : null}
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
        <div className="flex items-center justify-end p-3">
          <Button
            icon={<CloudDownload className="h-4 w-4" aria-hidden />}
            disabled={!selectedOrderNos.length}
            onClick={() => void handleExport()}
          >
            {t('exportSelected', { count: selectedOrderNos.length })}
          </Button>
        </div>
        <Table<AddressVerifyRow>
          rowKey="orderNo"
          columns={columns}
          dataSource={rows}
          loading={loading}
          rowSelection={{
            selectedRowKeys: selectedOrderNos,
            onChange: (keys) => setSelectedOrderNos(keys as string[]),
          }}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          scroll={{ x: 1460 }}
          locale={{ emptyText: t('emptyText') }}
        />
      </section>
    </div>
  )
}
