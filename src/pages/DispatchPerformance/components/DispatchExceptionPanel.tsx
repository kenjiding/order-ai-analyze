import { useCallback, useEffect, useState } from 'react'
import { App, Button, Drawer, Empty, Input, Popconfirm, Select, Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { Dayjs } from 'dayjs'
import { AlertTriangle, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  deleteDispatchPerformanceException,
  fetchDispatchPerformanceExceptions,
} from '../dispatchPerformanceApi'
import type {
  DispatchPerformanceException,
  DispatchPerformanceExceptionDraft,
  DispatchPerformanceSupplierOption,
} from '../dispatchPerformanceTypes'
import { DispatchExceptionModal } from './DispatchExceptionModal'

type Props = {
  open: boolean
  onClose: () => void
  configId: string
  range: [Dayjs, Dayjs]
  supplierOptions: DispatchPerformanceSupplierOption[]
  /** 从表格行内「已剔除 N 件」徽标点进来时带的初始筛选，面板顶部按钮打开时为空 */
  initialFilter?: { supplierKey?: string; routeCode?: string; courierCode?: string }
  /** 报备/撤回后通知父组件重新查询详情数据，让剔除数在主表格上同步刷新 */
  onChanged: () => void
}

export function DispatchExceptionPanel({
  open,
  onClose,
  configId,
  range,
  supplierOptions,
  initialFilter,
  onChanged,
}: Props) {
  const { t } = useTranslation(['dispatchPerformance', 'common'])
  const { message } = App.useApp()

  const [supplierKey, setSupplierKey] = useState<string | undefined>(undefined)
  const [routeCode, setRouteCode] = useState('')
  const [courierCode, setCourierCode] = useState('')
  const [rows, setRows] = useState<DispatchPerformanceException[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [modalDefaults, setModalDefaults] = useState<Partial<DispatchPerformanceExceptionDraft>>()

  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSupplierKey(initialFilter?.supplierKey)
    setRouteCode(initialFilter?.routeCode ?? '')
    setCourierCode(initialFilter?.courierCode ?? '')
  }, [open, initialFilter])

  const load = useCallback(async () => {
    if (!configId) return
    setLoading(true)
    try {
      const data = await fetchDispatchPerformanceExceptions(configId, {
        startDate: range[0].format('YYYY-MM-DD'),
        endDate: range[1].format('YYYY-MM-DD'),
        supplierKey: supplierKey || undefined,
        routeCode: routeCode.trim() || undefined,
        courierCode: courierCode.trim() || undefined,
      })
      setRows(data)
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('toast.queryError', { ns: 'dispatchPerformance' }))
    } finally {
      setLoading(false)
    }
  }, [configId, range, supplierKey, routeCode, courierCode, message, t])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) void load()
  }, [open, load])

  const handleDelete = async (row: DispatchPerformanceException) => {
    try {
      await deleteDispatchPerformanceException(configId, row.id)
      message.success(t('exception.withdrawSuccess', { ns: 'dispatchPerformance' }))
      await load()
      onChanged()
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('exception.withdrawError', { ns: 'dispatchPerformance' }))
    }
  }

  const columns: ColumnsType<DispatchPerformanceException> = [
    { title: t('exception.colDate', { ns: 'dispatchPerformance' }), dataIndex: 'arrivalDate', width: 140 },
    {
      title: t('exception.colSupplier', { ns: 'dispatchPerformance' }),
      dataIndex: 'supplierKey',
      render: (key: string) => supplierOptions.find((s) => s.supplierKey === key)?.supplierName ?? key,
    },
    {
      title: t('exception.colRoute', { ns: 'dispatchPerformance' }),
      dataIndex: 'routeCode',
      render: (v: string) => <span className="font-mono">{v || '—'}</span>,
    },
    {
      title: t('exception.colCourier', { ns: 'dispatchPerformance' }),
      dataIndex: 'courierCode',
      render: (v: string) => <span className="font-mono">{v || '—'}</span>,
    },
    {
      title: t('exception.colReported', { ns: 'dispatchPerformance' }),
      dataIndex: 'reportedCount',
      width: 110,
      align: 'right',
      // 只在「需要留意」时才加一行小字：未结算，或结算后有一部分没生效——
      // 全部生效是正常状态不用额外提示，省得每一行都堆着重复信息
      render: (reportedCount: number, row) => (
        <div className="flex flex-col items-end">
          <span className="tabular-nums">{reportedCount}</span>
          {!row.settled ? (
            <span className="text-xs text-slate-400">
              {t('exception.notSettledInline', { ns: 'dispatchPerformance' })}
            </span>
          ) : row.effectiveCount < reportedCount ? (
            <span className="text-xs text-amber-600">
              {t('exception.effectiveInline', { ns: 'dispatchPerformance', count: row.effectiveCount })}
            </span>
          ) : null}
        </div>
      ),
    },
    { title: t('exception.colReason', { ns: 'dispatchPerformance' }), dataIndex: 'reason', ellipsis: true },
    {
      title: t('exception.colActions', { ns: 'dispatchPerformance' }),
      key: 'actions',
      width: 80,
      render: (_: unknown, row) => (
        <Popconfirm
          title={t('exception.withdrawConfirmTitle', { ns: 'dispatchPerformance' })}
          description={t('exception.withdrawConfirmContent', { ns: 'dispatchPerformance' })}
          onConfirm={() => void handleDelete(row)}
          okText={t('exception.withdraw', { ns: 'dispatchPerformance' })}
          cancelText={t('cancel', { ns: 'common' })}
        >
          <Button type="text" danger icon={<Trash2 className="h-3.5 w-3.5" />} />
        </Popconfirm>
      ),
    },
  ]

  return (
    <Drawer
      open={open}
      onClose={onClose}
      placement="right"
      size={900}
      destroyOnHidden
      title={
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden />
          <span>{t('exception.panelTitle', { ns: 'dispatchPerformance' })}</span>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            allowClear
            value={supplierKey}
            onChange={setSupplierKey}
            placeholder={t('exception.filterSupplierPlaceholder', { ns: 'dispatchPerformance' })}
            options={supplierOptions.map((s) => ({ label: s.supplierName, value: s.supplierKey }))}
            className="min-w-[200px]"
          />
          <Input
            allowClear
            value={routeCode}
            onChange={(e) => setRouteCode(e.target.value)}
            placeholder={t('exception.filterRoutePlaceholder', { ns: 'dispatchPerformance' })}
            className="w-40"
          />
          <Input
            allowClear
            value={courierCode}
            onChange={(e) => setCourierCode(e.target.value)}
            placeholder={t('exception.filterCourierPlaceholder', { ns: 'dispatchPerformance' })}
            className="w-40"
          />
          <Button
            type="primary"
            icon={<Plus className="h-4 w-4" />}
            className="ml-auto"
            onClick={() => {
              setModalDefaults(supplierKey ? { supplierKey } : undefined)
              setModalOpen(true)
            }}
          >
            {t('exception.addButton', { ns: 'dispatchPerformance' })}
          </Button>
        </div>

        <Table
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={loading}
          pagination={{ pageSize: 20, hideOnSinglePage: true }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={t('exception.empty', { ns: 'dispatchPerformance' })}
              />
            ),
          }}
        />
      </div>

      <DispatchExceptionModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        configId={configId}
        supplierOptions={supplierOptions}
        defaults={modalDefaults}
        onCreated={() => {
          void load()
          onChanged()
        }}
      />
    </Drawer>
  )
}
