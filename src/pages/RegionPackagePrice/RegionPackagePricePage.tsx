import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, DatePicker, Form, Input, InputNumber, Modal, Select, Table, Tag, Tooltip, Upload } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { Dayjs } from 'dayjs'
import { DollarSign, Download, GitBranch, Pencil, Plus, Trash2, Upload as UploadIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { backendFetch } from '../../api/httpClient'
import { useAppSettings } from '../../context/AppSettingsContext'
import { fetchVendors } from '../VendorAnalysis/vendorAnalysisApi'
import { confirmDialog } from '../../utils/confirmDialog'
import { showToast } from '../../utils/toast'
import { defaultCourierPrice, parseRegionPackagePriceFile } from './regionPackagePriceImport'
import { exportRegionPackagePricesToXlsx } from './exportRegionPackagePrices'

export type RegionPackagePrice = {
  id: string
  regionCode: string
  postcode: string
  suburb: string
  price: number
  prePrice: number | null
  courierPrice: number
  vendorCode: string
  vendorName: string
  /** 该 postcode+suburb 当前覆盖的路由码，一对多；来自「对齐路由码」，只读 */
  routeCodes: string[]
}

type AlignRouteCodeResult = {
  inserted: number
  deleted: number
  vendorUpdated: number
  matchedAreas: number
  totalAreas: number
}

type PriceDraft = Pick<
  RegionPackagePrice,
  'postcode' | 'suburb' | 'price' | 'courierPrice' | 'vendorCode' | 'vendorName'
>

type VendorOption = { vendorCode: string; vendorNameEn: string }

async function callApi<T>(path: string, options?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await backendFetch(`/api/region-package-prices${path}`, {
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

// 空格/中英文逗号分隔多个关键词（一次查多个 postcode/suburb/路由码），同一栏内命中任一个即算匹配
function splitKeywords(raw: string): string[] {
  return raw
    .split(/[\s,，]+/)
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean)
}

type FormValues = {
  postcode: string
  suburb: string
  price: number
  courierPrice: number
  vendorCode?: string
}

export default function RegionPackagePricePage() {
  const { t } = useTranslation('regionPackagePrice')
  const { t: tc } = useTranslation('common')
  const { imileToken } = useAppSettings()
  const [form] = Form.useForm<FormValues>()
  const [prices, setPrices] = useState<RegionPackagePrice[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [postcodeKeyword, setPostcodeKeyword] = useState('')
  const [suburbKeyword, setSuburbKeyword] = useState('')
  const [routeCodeKeyword, setRouteCodeKeyword] = useState('')
  const [editing, setEditing] = useState<RegionPackagePrice | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [vendors, setVendors] = useState<VendorOption[]>([])
  const [vendorsLoading, setVendorsLoading] = useState(false)
  const [alignOpen, setAlignOpen] = useState(false)
  const [aligning, setAligning] = useState(false)
  const [alignRange, setAlignRange] = useState<[Dayjs, Dayjs] | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await callApi<RegionPackagePrice[]>('')
    setLoading(false)
    if (!res.ok) {
      showToast(res.error || t('requestFailed'), 'error')
      return
    }
    setPrices(res.data)
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  // 与「供应商配置」同源：编辑价格时只能从 iMile 供应商列表里选
  useEffect(() => {
    let cancelled = false
    setVendorsLoading(true)
    void fetchVendors(imileToken).then((res) => {
      if (cancelled) return
      setVendorsLoading(false)
      if (res.ok) {
        setVendors(res.data.map((v) => ({ vendorCode: v.vendorCode, vendorNameEn: v.vendorNameEn })))
      }
    })
    return () => {
      cancelled = true
    }
  }, [imileToken])

  const openForm = useCallback(
    (record: RegionPackagePrice | null) => {
      setEditing(record)
      form.setFieldsValue({
        postcode: record?.postcode ?? '',
        suburb: record?.suburb ?? '',
        price: record?.price ?? 0,
        courierPrice: record?.courierPrice ?? defaultCourierPrice(record?.price ?? 0),
        vendorCode: record?.vendorCode || undefined,
      })
      setFormOpen(true)
    },
    [form],
  )

  const submit = useCallback(async () => {
    const values = await form.validateFields()
    // 供应商名称跟着所选编码走，与 FleetSupplierEditModal 一致；选不到名称时退回编码
    const vendorCode = (values.vendorCode ?? '').trim()
    const selectedVendor = vendors.find((v) => v.vendorCode === vendorCode)
    const draft: PriceDraft = {
      postcode: values.postcode.trim(),
      suburb: values.suburb.trim(),
      price: values.price,
      courierPrice: values.courierPrice,
      vendorCode,
      vendorName: vendorCode ? (selectedVendor?.vendorNameEn ?? vendorCode) : '',
    }
    setSubmitting(true)
    const res = editing
      ? await callApi<RegionPackagePrice>(`/${editing.id}`, { method: 'PUT', body: JSON.stringify(draft) })
      : await callApi<RegionPackagePrice>('', { method: 'POST', body: JSON.stringify(draft) })
    setSubmitting(false)
    if (!res.ok) {
      showToast(res.error || t('requestFailed'), 'error')
      return
    }
    setPrices((prev) =>
      editing
        ? prev.map((item) => (item.id === res.data.id ? res.data : item))
        : [...prev, res.data].sort(
            (a, b) => a.postcode.localeCompare(b.postcode) || a.suburb.localeCompare(b.suburb),
          ),
    )
    showToast(editing ? t('toastUpdated') : t('toastAdded'), 'success')
    setFormOpen(false)
    setEditing(null)
  }, [editing, form, t, vendors])

  const remove = useCallback(
    async (record: RegionPackagePrice) => {
      const confirmed = await confirmDialog({
        title: t('confirmRemoveTitle', { suburb: record.suburb }),
        content: t('confirmRemoveContent', { postcode: record.postcode, suburb: record.suburb }),
        danger: true,
      })
      if (!confirmed) return
      const res = await callApi<{ id: string }>(`/${record.id}`, { method: 'DELETE' })
      if (!res.ok) {
        showToast(res.error || t('requestFailed'), 'error')
        return
      }
      setPrices((prev) => prev.filter((item) => item.id !== record.id))
      showToast(t('toastRemoved'), 'success')
    },
    [t],
  )

  const importFile = useCallback(
    async (file: File) => {
      setImporting(true)
      const parsed = await parseRegionPackagePriceFile(file)
      if (!parsed.ok) {
        setImporting(false)
        showToast(t(`importErr${parsed.error.charAt(0).toUpperCase()}${parsed.error.slice(1)}`), 'error')
        return
      }
      const res = await callApi<{ inserted: number; updated: number; invalid: number }>('/bulk', {
        method: 'POST',
        body: JSON.stringify({ prices: parsed.prices }),
      })
      setImporting(false)
      if (!res.ok) {
        showToast(res.error || t('requestFailed'), 'error')
        return
      }
      showToast(t('importDone', res.data), 'success')
      await load()
    },
    [load, t],
  )

  const alignRouteCode = useCallback(async () => {
    if (!alignRange) return
    setAligning(true)
    const res = await callApi<AlignRouteCodeResult>('/align-route-code', {
      method: 'POST',
      body: JSON.stringify({
        imileToken,
        startDate: alignRange[0].format('YYYY-MM-DD'),
        endDate: alignRange[1].format('YYYY-MM-DD'),
      }),
    })
    setAligning(false)
    if (!res.ok) {
      showToast(res.error || t('requestFailed'), 'error')
      return
    }
    showToast(t('alignDone', res.data), 'success')
    setAlignOpen(false)
    await load()
  }, [alignRange, imileToken, load, t])

  const filtered = useMemo(() => {
    const postcodeKws = splitKeywords(postcodeKeyword)
    const suburbKws = splitKeywords(suburbKeyword)
    const routeCodeKws = splitKeywords(routeCodeKeyword)
    if (postcodeKws.length === 0 && suburbKws.length === 0 && routeCodeKws.length === 0) return prices
    return prices.filter((item) => {
      const postcode = item.postcode.toLowerCase()
      const suburb = item.suburb.toLowerCase()
      const routeCodes = item.routeCodes.map((code) => code.toLowerCase())
      if (postcodeKws.length > 0 && !postcodeKws.some((kw) => postcode.includes(kw))) return false
      if (suburbKws.length > 0 && !suburbKws.some((kw) => suburb.includes(kw))) return false
      if (routeCodeKws.length > 0 && !routeCodeKws.some((kw) => routeCodes.some((code) => code.includes(kw))))
        return false
      return true
    })
  }, [prices, postcodeKeyword, suburbKeyword, routeCodeKeyword])

  const columns: ColumnsType<RegionPackagePrice> = useMemo(
    () => [
      {
        title: t('colPostcode'),
        dataIndex: 'postcode',
        key: 'postcode',
        width: 110,
        sorter: (a, b) => a.postcode.localeCompare(b.postcode),
        render: (value: string) => <span className="font-medium tabular-nums text-slate-900">{value}</span>,
      },
      {
        title: t('colSuburb'),
        dataIndex: 'suburb',
        key: 'suburb',
        width: 220,
        sorter: (a, b) => a.suburb.localeCompare(b.suburb),
      },
      {
        title: t('colPrice'),
        dataIndex: 'price',
        key: 'price',
        width: 120,
        sorter: (a, b) => a.price - b.price,
        render: (value: number) => <span className="font-medium tabular-nums text-slate-900">{value.toFixed(2)}</span>,
      },
      {
        title: t('colCourierPrice'),
        dataIndex: 'courierPrice',
        key: 'courierPrice',
        width: 130,
        sorter: (a, b) => a.courierPrice - b.courierPrice,
        render: (value: number) => <span className="tabular-nums text-slate-700">{value.toFixed(2)}</span>,
      },
      {
        title: t('colPrePrice'),
        dataIndex: 'prePrice',
        key: 'prePrice',
        width: 150,
        render: (value: number | null, record) => {
          if (value === null || value === undefined) return <span className="text-slate-400">—</span>
          const rising = record.price > value
          return (
            <span className="inline-flex items-center gap-1.5">
              <span className="tabular-nums text-slate-500">{value.toFixed(2)}</span>
              <Tag color={rising ? 'red' : 'green'} className="!mr-0">
                {`${rising ? '+' : ''}${(record.price - value).toFixed(2)}`}
              </Tag>
            </span>
          )
        },
      },
      {
        title: t('colRouteCodes'),
        dataIndex: 'routeCodes',
        key: 'routeCodes',
        width: 220,
        render: (value: string[]) => {
          if (!value || value.length === 0) return <span className="text-slate-400">—</span>
          const shown = value.slice(0, 4)
          const rest = value.slice(4)
          return (
            <div className="flex flex-wrap gap-1">
              {shown.map((code) => (
                <Tag key={code} className="!mr-0">
                  {code}
                </Tag>
              ))}
              {rest.length > 0 ? (
                <Tooltip title={rest.join(', ')}>
                  <Tag className="!mr-0">{t('routeCodesMore', { count: rest.length })}</Tag>
                </Tooltip>
              ) : null}
            </div>
          )
        },
      },
      {
        title: t('colVendor'),
        key: 'vendor',
        render: (_, record) => {
          if (!record.vendorName && !record.vendorCode) return <span className="text-slate-400">—</span>
          const label = record.vendorName || record.vendorCode
          return record.vendorCode ? <Tooltip title={record.vendorCode}>{label}</Tooltip> : label
        },
      },
      {
        title: t('colActions'),
        key: 'actions',
        width: 110,
        fixed: 'right',
        render: (_, record) => (
          <div className="flex items-center gap-1">
            <Button
              type="text"
              icon={<Pencil className="h-4 w-4" aria-hidden />}
              onClick={() => openForm(record)}
              aria-label={t('editAria')}
            />
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
    [openForm, remove, t],
  )

  return (
    <div className="admin-page space-y-5">
      <header className="admin-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#2f8f87]/15 text-[#1f6f68]">
              <DollarSign className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-950">{t('title')}</h1>
              <p className="mt-1 max-w-2xl text-sm text-slate-600">{t('description')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Upload
              accept=".xlsx,.xls,.csv"
              showUploadList={false}
              beforeUpload={(file) => {
                void importFile(file)
                return false
              }}
            >
              <Button loading={importing} icon={<UploadIcon className="h-4 w-4" aria-hidden />}>
                {t('importPrices')}
              </Button>
            </Upload>
            <Button
              color="cyan"
              variant="solid"
              icon={<Download className="h-4 w-4" aria-hidden />}
              onClick={() => exportRegionPackagePricesToXlsx(filtered, t)}
            >
              {t('exportPrices')}
            </Button>
            <Button
              icon={<GitBranch className="h-4 w-4" aria-hidden />}
              onClick={() => {
                setAlignRange(null)
                setAlignOpen(true)
              }}
            >
              {t('alignRouteCode')}
            </Button>
            <Button type="primary" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => openForm(null)}>
              {t('addPrice')}
            </Button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Input.Search
            allowClear
            className="w-48"
            placeholder={t('postcodeSearchPlaceholder')}
            value={postcodeKeyword}
            onChange={(event) => setPostcodeKeyword(event.target.value)}
          />
          <Input.Search
            allowClear
            className="w-48"
            placeholder={t('suburbSearchPlaceholder')}
            value={suburbKeyword}
            onChange={(event) => setSuburbKeyword(event.target.value)}
          />
          <Input.Search
            allowClear
            className="w-48"
            placeholder={t('routeCodeSearchPlaceholder')}
            value={routeCodeKeyword}
            onChange={(event) => setRouteCodeKeyword(event.target.value)}
          />
          <span className="inline-flex items-center rounded-md bg-slate-100 px-3 py-1 text-xs text-slate-600">
            {t('priceCount', { filtered: filtered.length, total: prices.length })}
          </span>
        </div>
      </header>

      <section className="admin-panel p-4 sm:p-5">
        <Table<RegionPackagePrice>
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: false, showTotal: (total) => t('tableTotal', { total }) }}
          scroll={{ x: 1260 }}
          locale={{ emptyText: t('emptyText') }}
        />
      </section>

      <Modal
        open={formOpen}
        title={editing ? t('editPrice') : t('addPrice')}
        okText={tc('save')}
        cancelText={tc('cancel')}
        confirmLoading={submitting}
        onOk={() => void submit()}
        onCancel={() => {
          setFormOpen(false)
          setEditing(null)
        }}
        destroyOnClose
      >
        <Form form={form} layout="vertical" className="pt-2">
          <Form.Item
            name="postcode"
            label={t('colPostcode')}
            rules={[{ required: true, message: t('postcodeRequired') }]}
          >
            <Input placeholder={t('postcodePlaceholder')} />
          </Form.Item>
          <Form.Item name="suburb" label={t('colSuburb')} rules={[{ required: true, message: t('suburbRequired') }]}>
            <Input placeholder={t('suburbPlaceholder')} />
          </Form.Item>
          <Form.Item
            name="price"
            label={t('colPrice')}
            rules={[{ required: true, message: t('priceRequired') }]}
            extra={editing ? t('prePriceHint') : undefined}
          >
            <InputNumber className="w-full" min={0} step={0.1} precision={2} />
          </Form.Item>
          <Form.Item
            name="courierPrice"
            label={t('colCourierPrice')}
            rules={[{ required: true, message: t('courierPriceRequired') }]}
            extra={t('courierPriceHint')}
          >
            <InputNumber className="w-full" min={0} step={0.1} precision={2} />
          </Form.Item>
          <Form.Item name="vendorCode" label={t('colVendor')} className="mb-0">
            <Select
              showSearch
              allowClear
              loading={vendorsLoading}
              placeholder={t('vendorPlaceholder')}
              filterOption={(input, opt) => (opt?.label ?? '').toLowerCase().includes(input.toLowerCase())}
              options={vendors.map((v) => ({
                label: `${v.vendorNameEn} (${v.vendorCode})`,
                value: v.vendorCode,
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={alignOpen}
        title={t('alignRouteCode')}
        okText={t('alignRouteCode')}
        cancelText={tc('cancel')}
        confirmLoading={aligning}
        okButtonProps={{ disabled: !alignRange }}
        onOk={() => void alignRouteCode()}
        onCancel={() => setAlignOpen(false)}
        destroyOnClose
      >
        <p className="mb-3 text-sm text-slate-600">{t('alignRouteCodeHint')}</p>
        <DatePicker.RangePicker
          className="w-full"
          value={alignRange}
          onChange={(values) => setAlignRange((values as [Dayjs, Dayjs] | null) ?? null)}
          format="YYYY-MM-DD"
          allowClear
        />
      </Modal>
    </div>
  )
}
