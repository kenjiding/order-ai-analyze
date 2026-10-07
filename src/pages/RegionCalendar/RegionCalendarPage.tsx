import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, DatePicker, Form, Input, Modal, Segmented, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs, { type Dayjs } from 'dayjs'
import { CalendarDays, Pencil, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { backendFetch } from '../../api/httpClient'
import { AU_REGIONS } from '../ExitAlarm/exitAlarmTypes'
import { useAuthStore } from '../../stores/authStore'
import { confirmDialog } from '../../utils/confirmDialog'
import { showToast } from '../../utils/toast'

export type RegionCalendarOverride = {
  id: string
  regionCode: string
  date: string
  isExitDay: boolean | null
  isDispatchDay: boolean | null
  note: string
}

/**
 * 只开放两个固定预设，不让用户自己拼出仓/派送的任意组合——现实里的例外就这两种形状：
 * - 假期：派送停，出仓不用管（早取服务照常，按默认规则走）
 * - 周末临时开仓：出仓开，派送不用管（司机未必加派，按默认规则走）
 * 「出仓」和「派送」从不会在同一条例外里都被显式覆盖，所以不需要更通用的任意组合表单。
 */
type OverrideKind = 'holiday' | 'adhocOpen'

const KIND_VALUES: Record<OverrideKind, { isExitDay: boolean | null; isDispatchDay: boolean | null }> = {
  holiday: { isExitDay: null, isDispatchDay: false },
  adhocOpen: { isExitDay: true, isDispatchDay: null },
}

/** 反向识别：编辑已有记录时推断它属于哪个预设；不属于任何预设（如直接调 API 写入的怪异组合）则返回 null */
function classifyKind(row: { isExitDay: boolean | null; isDispatchDay: boolean | null }): OverrideKind | null {
  if (row.isExitDay === null && row.isDispatchDay === false) return 'holiday'
  if (row.isExitDay === true && row.isDispatchDay === null) return 'adhocOpen'
  return null
}

async function callApi<T>(
  path: string,
  options?: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await backendFetch(`/api/region-calendar-overrides${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    })
    const json = (await res.json()) as { ok?: boolean; data?: T; error?: string }
    if (json.ok === true) return { ok: true, data: json.data as T }
    return { ok: false, error: typeof json.error === 'string' ? json.error : '' }
  } catch {
    return { ok: false, error: '' }
  }
}

type FormValues = {
  dateRange: [Dayjs, Dayjs]
  kind: OverrideKind
  note?: string
}

/** 新增时支持连续多天一次性录入（同一套出仓/派送设置），防止误操作批量建出一大串日期 */
const MAX_RANGE_DAYS = 60

function enumerateDates(start: Dayjs, end: Dayjs): string[] {
  const dates: string[] = []
  let cur = start.startOf('day')
  const last = end.startOf('day')
  while (!cur.isAfter(last)) {
    dates.push(cur.format('YYYY-MM-DD'))
    cur = cur.add(1, 'day')
  }
  return dates
}

export default function RegionCalendarPage() {
  const { t } = useTranslation('regionCalendar')
  const { t: tc } = useTranslation('common')
  const [form] = Form.useForm<FormValues>()
  const { isSuperAdmin, user } = useAuthStore()
  // 普通用户新建账号时已确定所属州，不需要再选——直接锁定管理自己的州；
  // 超管(regionCode='system')不对应真实州，才需要自由切换查看/管理任意州。
  const ownRegionCode = user?.regionCode ?? null
  const [regionCode, setRegionCode] = useState(
    isSuperAdmin ? AU_REGIONS[0]?.code ?? '' : ownRegionCode ?? '',
  )
  const [rows, setRows] = useState<RegionCalendarOverride[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [editing, setEditing] = useState<RegionCalendarOverride | null>(null)
  const [formOpen, setFormOpen] = useState(false)

  const load = useCallback(async (code: string) => {
    if (!code) return
    setLoading(true)
    const res = await callApi<RegionCalendarOverride[]>(`?regionCode=${encodeURIComponent(code)}`)
    setLoading(false)
    if (!res.ok) {
      showToast(res.error || t('requestFailed'), 'error')
      return
    }
    setRows(res.data)
  }, [t])

  useEffect(() => {
    void load(regionCode)
  }, [load, regionCode])

  const openForm = useCallback(
    (record: RegionCalendarOverride | null) => {
      setEditing(record)
      form.setFieldsValue({
        dateRange: record ? [dayjs(record.date), dayjs(record.date)] : [dayjs(), dayjs()],
        kind: (record && classifyKind(record)) ?? 'holiday',
        note: record?.note ?? '',
      })
      setFormOpen(true)
    },
    [form],
  )

  const submit = useCallback(async () => {
    const values = await form.validateFields()
    const dates = editing
      ? [editing.date]
      : enumerateDates(values.dateRange[0], values.dateRange[1])
    if (dates.length > MAX_RANGE_DAYS) {
      showToast(t('rangeTooLong', { max: MAX_RANGE_DAYS }), 'error')
      return
    }
    const common = {
      regionCode,
      ...KIND_VALUES[values.kind],
      note: (values.note ?? '').trim(),
    }
    setSubmitting(true)
    let savedCount = 0
    for (const date of dates) {
      const res = await callApi<RegionCalendarOverride>('', {
        method: 'POST',
        body: JSON.stringify({ ...common, date }),
      })
      if (!res.ok) {
        setSubmitting(false)
        showToast(`${date}: ${res.error || t('requestFailed')}`, 'error')
        await load(regionCode)
        return
      }
      savedCount += 1
    }
    setSubmitting(false)
    showToast(savedCount > 1 ? t('toastAddedCount', { count: savedCount }) : t('toastAdded'), 'success')
    setFormOpen(false)
    setEditing(null)
    await load(regionCode)
  }, [editing, form, load, regionCode, t])

  const remove = useCallback(
    async (record: RegionCalendarOverride) => {
      const confirmed = await confirmDialog({
        title: t('confirmRemoveTitle', { date: record.date }),
        content: t('confirmRemoveContent'),
        danger: true,
      })
      if (!confirmed) return
      const res = await callApi<{ id: string }>(`/${record.id}`, { method: 'DELETE' })
      if (!res.ok) {
        showToast(res.error || t('requestFailed'), 'error')
        return
      }
      setRows((prev) => prev.filter((item) => item.id !== record.id))
      showToast(t('toastRemoved'), 'success')
    },
    [t],
  )

  const triTag = useCallback(
    (value: boolean | null) => {
      if (value === null) return <Tag>{t('triDefault')}</Tag>
      return value ? <Tag color="green">{t('triOpen')}</Tag> : <Tag color="red">{t('triClosed')}</Tag>
    },
    [t],
  )

  const kindOptions = useMemo(
    () => [
      { label: t('kindHoliday'), value: 'holiday' },
      { label: t('kindAdhocOpen'), value: 'adhocOpen' },
    ],
    [t],
  )

  const kindTag = useCallback(
    (row: RegionCalendarOverride) => {
      const kind = classifyKind(row)
      if (kind === 'holiday') return <Tag color="red">{t('kindHoliday')}</Tag>
      if (kind === 'adhocOpen') return <Tag color="green">{t('kindAdhocOpen')}</Tag>
      // 不属于任何预设的怪异组合（如直接调 API 写入）：原样展示两个维度，别悄悄藏起来
      return (
        <span className="inline-flex flex-wrap items-center gap-1 text-xs text-slate-500">
          <span>{t('colExitDay')}</span>
          {triTag(row.isExitDay)}
          <span>{t('colDispatchDay')}</span>
          {triTag(row.isDispatchDay)}
        </span>
      )
    },
    [t, triTag],
  )

  const columns: ColumnsType<RegionCalendarOverride> = useMemo(
    () => [
      {
        title: t('colDate'),
        dataIndex: 'date',
        key: 'date',
        width: 140,
        sorter: (a, b) => a.date.localeCompare(b.date),
        defaultSortOrder: 'ascend',
        render: (value: string) => <span className="font-medium tabular-nums text-slate-900">{value}</span>,
      },
      {
        title: t('colKind'),
        key: 'kind',
        width: 160,
        render: (_, record) => kindTag(record),
      },
      {
        title: t('colNote'),
        dataIndex: 'note',
        key: 'note',
        render: (value: string) => value || <span className="text-slate-400">—</span>,
      },
      {
        title: t('colActions'),
        key: 'actions',
        width: 110,
        fixed: 'right',
        render: (_, record) => (
          <div className="flex items-center gap-1">
            <Button type="text" icon={<Pencil className="h-4 w-4" aria-hidden />} onClick={() => openForm(record)} />
            <Button
              type="text"
              danger
              icon={<Trash2 className="h-4 w-4" aria-hidden />}
              onClick={() => void remove(record)}
              aria-label={t('deleteAria')}
            />
          </div>
        ),
      },
    ],
    [kindTag, openForm, remove, t],
  )

  return (
    <div className="admin-page space-y-5">
      <header className="admin-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#2f8f87]/15 text-[#1f6f68]">
              <CalendarDays className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-950">{t('title')}</h1>
              <p className="mt-1 max-w-3xl text-sm text-slate-600">{t('description')}</p>
            </div>
          </div>
          <Button type="primary" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => openForm(null)}>
            {t('addOverride')}
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <span className="text-sm text-slate-600">{t('regionLabel')}</span>
          {isSuperAdmin ? (
            <Select
              className="w-48"
              value={regionCode}
              onChange={setRegionCode}
              options={AU_REGIONS.map((r) => ({ label: r.name, value: r.code }))}
            />
          ) : (
            <Select
              className="w-48"
              disabled
              value={ownRegionCode ?? undefined}
              options={[
                {
                  label: AU_REGIONS.find((r) => r.code === ownRegionCode)?.name ?? ownRegionCode ?? '—',
                  value: ownRegionCode ?? '',
                },
              ]}
            />
          )}
          <span className="inline-flex items-center rounded-md bg-slate-100 px-3 py-1 text-xs text-slate-600">
            {t('tableTotal', { total: rows.length })}
          </span>
        </div>
      </header>

      <section className="admin-panel p-4 sm:p-5">
        <Table<RegionCalendarOverride>
          rowKey="id"
          columns={columns}
          dataSource={rows}
          loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: false, showTotal: (total) => t('tableTotal', { total }) }}
          scroll={{ x: 680 }}
          locale={{ emptyText: t('emptyText') }}
        />
      </section>

      <Modal
        open={formOpen}
        title={editing ? `${t('colDate')} ${editing.date}` : t('addOverride')}
        okText={tc('save')}
        cancelText={tc('cancel')}
        confirmLoading={submitting}
        onOk={() => void submit()}
        onCancel={() => {
          setFormOpen(false)
          setEditing(null)
        }}
        destroyOnClose
        width={560}
      >
        <Form form={form} layout="vertical" className="pt-2">
          <Form.Item name="kind" label={t('kindLabel')} className="mb-1">
            <Segmented block options={kindOptions} />
          </Form.Item>
          <Form.Item shouldUpdate={(prev, cur) => prev.kind !== cur.kind} noStyle>
            {() => (
              <p className="mb-4 text-xs leading-snug text-slate-400">
                {t(form.getFieldValue('kind') === 'adhocOpen' ? 'kindAdhocOpenHint' : 'kindHolidayHint')}
              </p>
            )}
          </Form.Item>

          <Form.Item
            name="dateRange"
            label={t('colDate')}
            extra={editing ? undefined : t('dateRangeHint')}
            rules={[{ required: true, message: t('dateRequired') }]}
            className="mb-4"
          >
            <DatePicker.RangePicker className="w-full" disabled={editing != null} allowClear={false} />
          </Form.Item>

          <Form.Item name="note" label={t('noteLabel')} className="mb-0">
            <Input placeholder={t('notePlaceholder')} maxLength={255} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
