import { useMemo } from 'react'
import { Button, DatePicker, Empty, Popconfirm, Progress, Select, Table, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs, { type Dayjs } from 'dayjs'
import { PackageCheck, RefreshCw, RotateCcw, Search } from 'lucide-react'
import { isBagFinishSuccess } from './bagFinish'
import type { BagRow } from './useReturnToMerchantFinishPage'
import { useReturnToMerchantFinishPage } from './useReturnToMerchantFinishPage'

const { RangePicker } = DatePicker
const DASH = '—'

const rangePresets = [
  { label: '近 1 周', value: [dayjs().subtract(7, 'day').startOf('day'), dayjs().endOf('day')] as [Dayjs, Dayjs] },
  { label: '近 2 周', value: [dayjs().subtract(14, 'day').startOf('day'), dayjs().endOf('day')] as [Dayjs, Dayjs] },
  { label: '近 30 天', value: [dayjs().subtract(30, 'day').startOf('day'), dayjs().endOf('day')] as [Dayjs, Dayjs] },
]

function StatBlock({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-[104px]">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{value}</div>
      {hint ? <div className="text-xs text-slate-400">{hint}</div> : null}
    </div>
  )
}

export default function ReturnToMerchantFinishPage() {
  const page = useReturnToMerchantFinishPage()
  const { results } = page

  const summary = useMemo(() => {
    const all = Object.values(results)
    const success = all.filter(isBagFinishSuccess).length
    return { total: all.length, success, failed: all.length - success }
  }, [results])

  const columns: ColumnsType<BagRow> = [
    {
      title: '集包号',
      dataIndex: 'bagNumber',
      width: 190,
      render: (value: string) => <span className="font-mono text-slate-900">{value}</span>,
    },
    {
      title: '集包创建时间',
      dataIndex: 'createDate',
      width: 180,
      sorter: (a, b) => a.createDate.localeCompare(b.createDate),
      render: (value: string) => <span className="tabular-nums text-slate-600">{value || DASH}</span>,
    },
    {
      title: '退返商家编码',
      dataIndex: 'targetCode',
      width: 150,
      render: (value: string) =>
        value ? <span className="font-mono text-slate-700">{value}</span> : <span className="text-slate-400">{DASH}</span>,
    },
    {
      title: '集包订单数量',
      dataIndex: 'waybillTotalCount',
      width: 120,
      align: 'right',
      sorter: (a, b) => a.waybillTotalCount - b.waybillTotalCount,
      render: (value: number) => <span className="tabular-nums">{value}</span>,
    },
    {
      title: '集包类型',
      dataIndex: 'type',
      width: 120,
      render: (value: string) =>
        value ? <Tag color={value === '退返商家' ? 'cyan' : 'default'}>{value}</Tag> : DASH,
    },
    {
      title: '完结结果',
      key: 'result',
      width: 260,
      render: (_, row) => {
        const result = results[row.bagNumber]
        if (!result) return <span className="text-slate-400">未提交</span>
        if (isBagFinishSuccess(result)) {
          return (
            <Tooltip title={result.operateTypeDesc || ''}>
              <Tag color="green">退返商家成功</Tag>
            </Tooltip>
          )
        }
        const reason = result.blockInfo || result.error || `blockCode=${String(result.blockCode)}`
        return (
          <Tooltip title={reason}>
            <span className="flex items-center gap-1.5">
              <Tag color="red">失败</Tag>
              <span className="truncate text-xs text-red-600">{reason}</span>
            </span>
          </Tooltip>
        )
      },
    },
  ]

  return (
    <div className="admin-page space-y-5">
      <header className="admin-panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#2f8f87]/15 text-[#1f6f68]">
              <PackageCheck className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-950">退返商家完结</h1>
              <p className="mt-1 max-w-3xl text-sm text-slate-600">
                按集包创建时间拉取责任站点的集包，勾选后批量提交 iMile 退返商家完结；同一集包号只提交一次。
              </p>
            </div>
          </div>
          <Tooltip title="取自页面顶部「站点选择器」">
            <Tag color="cyan" className="mt-1">
              责任站点：{page.stationLabel || '未选择'}
            </Tag>
          </Tooltip>
        </div>
      </header>

      <section className="admin-panel space-y-4 p-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-slate-500">集包创建时间</span>
            <RangePicker
              className="w-[260px]"
              allowClear={false}
              presets={rangePresets}
              value={page.range}
              onChange={(value) => {
                if (value?.[0] && value[1]) page.setRange([value[0], value[1]])
              }}
            />
          </label>
          <Button
            type="primary"
            icon={<Search className="h-4 w-4" aria-hidden />}
            loading={page.loading}
            onClick={() => void page.load()}
          >
            查询集包
          </Button>
          {page.loadedAt ? (
            <span className="pb-1.5 text-xs text-slate-400">最近查询 {page.loadedAt}</span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-end gap-3 border-t border-[var(--admin-line)] pt-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-slate-500">集包类型</span>
            <Select
              className="w-40"
              placeholder="全部"
              allowClear
              value={page.filters.type}
              onChange={(value) => page.setFilters((prev) => ({ ...prev, type: value }))}
              options={page.typeOptions.map((value) => ({ value, label: value }))}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-slate-500">退返商家编码</span>
            <Select
              className="w-52"
              placeholder="全部"
              allowClear
              showSearch
              optionFilterProp="label"
              value={page.filters.targetCode}
              onChange={(value) => page.setFilters((prev) => ({ ...prev, targetCode: value }))}
              options={page.targetCodeOptions.map((value) => ({ value, label: value }))}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-slate-500">集包创建日期</span>
            <DatePicker
              className="w-40"
              placeholder="全部"
              value={page.filters.createDate}
              onChange={(value) => page.setFilters((prev) => ({ ...prev, createDate: value }))}
            />
          </label>
          <Button icon={<RotateCcw className="h-4 w-4" aria-hidden />} onClick={page.resetFilters}>
            重置筛选
          </Button>
          <span className="pb-1.5 text-xs text-slate-500">
            共 {page.rows.length} 条，筛选后 {page.filteredRows.length} 条
          </span>
        </div>
      </section>

      <section className="admin-panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--admin-line)] px-5 py-4">
          <div className="flex flex-wrap items-center gap-6">
            <StatBlock
              label="已选集包"
              value={String(page.selectedBags.length)}
              hint={`去重后，合计 ${page.selectedWaybillCount} 单`}
            />
            {summary.total > 0 ? (
              <>
                <StatBlock label="完结成功" value={String(summary.success)} />
                <StatBlock label="完结失败" value={String(summary.failed)} />
              </>
            ) : null}
          </div>
          <div className="flex items-center gap-3">
            {page.progress && page.submitting ? (
              <Progress
                className="w-40"
                percent={Math.round((page.progress.done / Math.max(1, page.progress.total)) * 100)}
                status="active"
              />
            ) : null}
            <Popconfirm
              title="确认提交退返商家完结？"
              description={`将对 ${page.selectedBags.length} 个集包（${page.selectedWaybillCount} 单）提交完结，操作不可撤销。`}
              okText="确认提交"
              cancelText="再想想"
              disabled={page.selectedBags.length === 0 || page.submitting}
              onConfirm={() => void page.submit()}
            >
              <Button
                type="primary"
                icon={<PackageCheck className="h-4 w-4" aria-hidden />}
                loading={page.submitting}
                disabled={page.selectedBags.length === 0}
              >
                退返商家完结
              </Button>
            </Popconfirm>
            <Tooltip title="重新查询当前时间区间">
              <Button
                icon={<RefreshCw className="h-4 w-4" aria-hidden />}
                loading={page.loading}
                onClick={() => void page.load()}
              />
            </Tooltip>
          </div>
        </div>

        <Table<BagRow>
          rowKey="key"
          columns={columns}
          dataSource={page.filteredRows}
          loading={page.loading}
          scroll={{ x: 1060 }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={page.rows.length ? '当前筛选条件下没有集包' : '选择集包创建时间后点击「查询集包」'}
              />
            ),
          }}
          pagination={{ showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
          rowSelection={{
            selectedRowKeys: page.selectedKeys,
            onChange: (keys) => page.setSelectedKeys(keys as string[]),
            getCheckboxProps: (row) => ({
              disabled: !row.targetCode || page.submitting,
              title: row.targetCode ? undefined : '该集包没有退返商家编码，无法提交完结',
            }),
          }}
        />
      </section>
    </div>
  )
}
