import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Empty, Form, Input, Modal, Select, Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { Pencil, Plus, Trash2, Warehouse } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { backendFetch } from '../../api/httpClient'
import { useGlobalFilterStore } from '../../stores/globalFilterStore'
import { confirmDialog } from '../../utils/confirmDialog'
import { showToast } from '../../utils/toast'
import { ADELAIDE_MAP_CENTER } from '../VendorRegionMap/vendorRegionMapTypes'
import { StationLocationPicker, type LocationValue } from './StationLocationPicker'

type RegionWarehouse = { regionCode: string; name: string; address: string; lat: number; lng: number; updatedAt: string }
type StationCoordinate = {
  stationCode: string
  stationName: string
  address: string
  lat: number
  lng: number
  updatedAt: string
}

async function callApi<T>(
  path: string,
  options?: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await backendFetch(path, { headers: { 'Content-Type': 'application/json' }, ...options })
    const json = (await res.json()) as { ok?: boolean; data?: T; error?: string }
    if (json.ok === true) return { ok: true, data: json.data as T }
    return { ok: false, error: typeof json.error === 'string' ? json.error : '' }
  } catch {
    return { ok: false, error: '' }
  }
}

const emptyLocation: LocationValue = { address: '', lat: null, lng: null }

export default function WarehouseSettingsPage() {
  const { t } = useTranslation('warehouseSettings')
  const { t: tc } = useTranslation('common')
  const { stations: stationOptions } = useGlobalFilterStore()

  // ---- 大区主仓：每个账号所属的州只有一条 ----
  const [regionWarehouse, setRegionWarehouse] = useState<RegionWarehouse | null>(null)
  const [warehouseLoading, setWarehouseLoading] = useState(true)
  const [warehouseFormOpen, setWarehouseFormOpen] = useState(false)
  const [warehouseName, setWarehouseName] = useState('')
  const [warehouseLocation, setWarehouseLocation] = useState<LocationValue>(emptyLocation)
  const [warehouseSubmitting, setWarehouseSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    callApi<RegionWarehouse | null>('/api/region-warehouses').then((res) => {
      if (cancelled) return
      setWarehouseLoading(false)
      if (!res.ok) {
        showToast(res.error || t('requestFailed'), 'error')
        return
      }
      setRegionWarehouse(res.data)
    })
    return () => {
      cancelled = true
    }
  }, [t])

  const openWarehouseForm = useCallback(() => {
    setWarehouseName(regionWarehouse?.name ?? '')
    setWarehouseLocation(
      regionWarehouse
        ? { address: regionWarehouse.address, lat: regionWarehouse.lat, lng: regionWarehouse.lng }
        : emptyLocation,
    )
    setWarehouseFormOpen(true)
  }, [regionWarehouse])

  const submitWarehouse = useCallback(async () => {
    if (!warehouseName.trim()) {
      showToast(t('nameRequired'), 'error')
      return
    }
    if (!warehouseLocation.address.trim()) {
      showToast(t('addressRequired'), 'error')
      return
    }
    if (warehouseLocation.lat == null || warehouseLocation.lng == null) {
      showToast(t('coordsRequired'), 'error')
      return
    }
    setWarehouseSubmitting(true)
    const res = await callApi<RegionWarehouse>('/api/region-warehouses', {
      method: 'PUT',
      body: JSON.stringify({
        name: warehouseName.trim(),
        address: warehouseLocation.address.trim(),
        lat: warehouseLocation.lat,
        lng: warehouseLocation.lng,
      }),
    })
    setWarehouseSubmitting(false)
    if (!res.ok) {
      showToast(res.error || t('requestFailed'), 'error')
      return
    }
    setRegionWarehouse(res.data)
    showToast(t('toastSaved'), 'success')
    setWarehouseFormOpen(false)
  }, [warehouseName, warehouseLocation, t])

  // ---- 站点坐标：不按州隔离，全公司共用 ----
  const [stations, setStations] = useState<StationCoordinate[]>([])
  const [stationsLoading, setStationsLoading] = useState(true)
  const [stationFormOpen, setStationFormOpen] = useState(false)
  const [editingStation, setEditingStation] = useState<StationCoordinate | null>(null)
  const [stationCode, setStationCode] = useState<string | undefined>(undefined)
  const [stationLocation, setStationLocation] = useState<LocationValue>(emptyLocation)
  const [stationSubmitting, setStationSubmitting] = useState(false)

  useEffect(() => {
    let cancelled = false
    callApi<StationCoordinate[]>('/api/station-coordinates').then((res) => {
      if (cancelled) return
      setStationsLoading(false)
      if (!res.ok) {
        showToast(res.error || t('requestFailed'), 'error')
        return
      }
      setStations(res.data)
    })
    return () => {
      cancelled = true
    }
  }, [t])

  const configuredCodes = useMemo(() => new Set(stations.map((s) => s.stationCode)), [stations])

  const openStationForm = useCallback((record: StationCoordinate | null) => {
    setEditingStation(record)
    setStationCode(record?.stationCode)
    setStationLocation(record ? { address: record.address, lat: record.lat, lng: record.lng } : emptyLocation)
    setStationFormOpen(true)
  }, [])

  const submitStation = useCallback(async () => {
    if (!stationCode) {
      showToast(t('stationRequired'), 'error')
      return
    }
    if (!stationLocation.address.trim()) {
      showToast(t('addressRequired'), 'error')
      return
    }
    if (stationLocation.lat == null || stationLocation.lng == null) {
      showToast(t('coordsRequired'), 'error')
      return
    }
    const stationName = stationOptions.find((s) => s.value === stationCode)?.label ?? editingStation?.stationName ?? stationCode
    const draft = {
      stationName,
      address: stationLocation.address.trim(),
      lat: stationLocation.lat,
      lng: stationLocation.lng,
    }
    setStationSubmitting(true)
    const res = editingStation
      ? await callApi<StationCoordinate>(`/api/station-coordinates/${editingStation.stationCode}`, {
          method: 'PUT',
          body: JSON.stringify(draft),
        })
      : await callApi<StationCoordinate>('/api/station-coordinates', {
          method: 'POST',
          body: JSON.stringify({ ...draft, stationCode }),
        })
    setStationSubmitting(false)
    if (!res.ok) {
      showToast(res.error || t('requestFailed'), 'error')
      return
    }
    setStations((prev) =>
      editingStation
        ? prev.map((s) => (s.stationCode === res.data.stationCode ? res.data : s))
        : [...prev, res.data].sort((a, b) => a.stationName.localeCompare(b.stationName)),
    )
    showToast(t('toastSaved'), 'success')
    setStationFormOpen(false)
    setEditingStation(null)
  }, [stationCode, stationLocation, stationOptions, editingStation, t])

  const removeStation = useCallback(
    async (record: StationCoordinate) => {
      const confirmed = await confirmDialog({
        title: t('confirmRemoveTitle', { name: record.stationName }),
        content: t('confirmRemoveContent'),
        danger: true,
      })
      if (!confirmed) return
      const res = await callApi<{ stationCode: string }>(`/api/station-coordinates/${record.stationCode}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        showToast(res.error || t('requestFailed'), 'error')
        return
      }
      setStations((prev) => prev.filter((s) => s.stationCode !== record.stationCode))
      showToast(t('toastRemoved'), 'success')
    },
    [t],
  )

  const columns: ColumnsType<StationCoordinate> = useMemo(
    () => [
      {
        title: t('colStationName'),
        dataIndex: 'stationName',
        key: 'stationName',
        sorter: (a, b) => a.stationName.localeCompare(b.stationName),
      },
      { title: t('colStationCode'), dataIndex: 'stationCode', key: 'stationCode', width: 140 },
      { title: t('colAddress'), dataIndex: 'address', key: 'address' },
      {
        title: t('colActions'),
        key: 'actions',
        width: 100,
        fixed: 'right',
        render: (_, record) => (
          <div className="flex items-center gap-1">
            <Button
              type="text"
              icon={<Pencil className="h-4 w-4" aria-hidden />}
              onClick={() => openStationForm(record)}
              aria-label={t('editAria')}
            />
            <Button
              type="text"
              danger
              icon={<Trash2 className="h-4 w-4" aria-hidden />}
              onClick={() => void removeStation(record)}
              aria-label={t('deleteAria')}
            />
          </div>
        ),
      },
    ],
    [openStationForm, removeStation, t],
  )

  const stationSelectOptions = useMemo(
    () =>
      stationOptions
        .filter((s) => !configuredCodes.has(s.value) || s.value === editingStation?.stationCode)
        .map((s) => ({ label: `${s.label} (${s.value})`, value: s.value })),
    [stationOptions, configuredCodes, editingStation],
  )

  const mapDefaultCenter = regionWarehouse ? { lat: regionWarehouse.lat, lng: regionWarehouse.lng } : ADELAIDE_MAP_CENTER

  return (
    <div className="admin-page space-y-5">
      <header className="admin-panel p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#2f8f87]/15 text-[#1f6f68]">
            <Warehouse className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-950">{t('title')}</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">{t('description')}</p>
          </div>
        </div>
      </header>

      <section className="admin-panel space-y-3 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">{t('regionWarehouseTitle')}</h2>
          <Button type="primary" icon={<Pencil className="h-4 w-4" aria-hidden />} onClick={openWarehouseForm} loading={warehouseLoading}>
            {regionWarehouse ? t('editWarehouse') : t('setWarehouse')}
          </Button>
        </div>
        {!warehouseLoading && !regionWarehouse ? <Alert type="warning" showIcon message={t('warehouseNotConfigured')} /> : null}
        {regionWarehouse ? (
          <div className="text-sm text-slate-700">
            <div className="font-medium">{regionWarehouse.name}</div>
            <div className="text-slate-500">{regionWarehouse.address}</div>
          </div>
        ) : null}
      </section>

      <section className="admin-panel space-y-3 p-4 sm:p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{t('stationsTitle')}</h2>
            <p className="mt-1 text-sm text-slate-500">{t('stationsDescription')}</p>
          </div>
          <Button type="primary" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => openStationForm(null)}>
            {t('addStation')}
          </Button>
        </div>
        <Table<StationCoordinate>
          rowKey="stationCode"
          columns={columns}
          dataSource={stations}
          loading={stationsLoading}
          pagination={{ pageSize: 20, showSizeChanger: false, showTotal: (total) => t('tableTotal', { total }) }}
          locale={{ emptyText: <Empty description={t('stationsEmpty')} /> }}
        />
      </section>

      <Modal
        open={warehouseFormOpen}
        title={regionWarehouse ? t('editWarehouse') : t('setWarehouse')}
        okText={tc('save')}
        cancelText={tc('cancel')}
        confirmLoading={warehouseSubmitting}
        onOk={() => void submitWarehouse()}
        onCancel={() => setWarehouseFormOpen(false)}
        destroyOnClose
        width={640}
      >
        <div className="space-y-4 pt-2">
          <Form layout="vertical">
            <Form.Item label={t('colWarehouseName')} required className="mb-0">
              <Input
                value={warehouseName}
                onChange={(e) => setWarehouseName(e.target.value)}
                placeholder={t('warehouseNamePlaceholder')}
              />
            </Form.Item>
          </Form>
          <StationLocationPicker value={warehouseLocation} onChange={setWarehouseLocation} defaultCenter={ADELAIDE_MAP_CENTER} />
        </div>
      </Modal>

      <Modal
        open={stationFormOpen}
        title={editingStation ? t('editStation') : t('addStation')}
        okText={tc('save')}
        cancelText={tc('cancel')}
        confirmLoading={stationSubmitting}
        onOk={() => void submitStation()}
        onCancel={() => {
          setStationFormOpen(false)
          setEditingStation(null)
        }}
        destroyOnClose
        width={640}
      >
        <div className="space-y-4 pt-2">
          <Form layout="vertical">
            <Form.Item label={t('colStationName')} required className="mb-0">
              <Select
                showSearch
                disabled={!!editingStation}
                value={stationCode}
                onChange={setStationCode}
                placeholder={t('stationPlaceholder')}
                filterOption={(input, opt) => (opt?.label ?? '').toLowerCase().includes(input.toLowerCase())}
                options={stationSelectOptions}
              />
            </Form.Item>
          </Form>
          <StationLocationPicker value={stationLocation} onChange={setStationLocation} defaultCenter={mapDefaultCenter} />
        </div>
      </Modal>
    </div>
  )
}
