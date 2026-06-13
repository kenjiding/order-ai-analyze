// @ts-nocheck
import { Table } from 'antd'
import { Edit2, Save, Trash2, X } from 'lucide-react'
import { WageAntdTable } from './WageAntdTable'

export function WageRecordsTable({
  filteredWageRecords,
  currentPage,
  setCurrentPage,
  pageSize,
  setPageSize,
  rowEditingData,
  setRowEditingData,
  roles,
  roleMap,
  formatDate,
  formatWorkday,
  startRowEditing,
  saveRowEditing,
  cancelRowEditing,
  handleDeleteRecord,
  canEditRecord = true,
}) {
  const pageStart = (currentPage - 1) * pageSize
  const pageRows = filteredWageRecords.slice(pageStart, pageStart + pageSize)
  const pageHoursSum = pageRows.reduce((sum, r) => sum + r.totalHoursDecimal, 0)
  const pageWageSum = pageRows.reduce((sum, r) => sum + r.totalWage, 0)

  const columns = [
    {
      title: '人员编号',
      dataIndex: 'employeeId',
      key: 'employeeId',
      width: 110,
      ellipsis: true,
    },
    {
      title: '昵称',
      dataIndex: 'nickname',
      key: 'nickname',
      width: 100,
      ellipsis: true,
      render: (v) => v || '-',
    },
    {
      title: '日期',
      key: 'date',
      width: 130,
      render: (_, record) => {
        const isRowEditing = rowEditingData[record._id] !== undefined
        const editData = rowEditingData[record._id]
        if (isRowEditing) {
          return (
            <input
              type="date"
              value={editData.date || ''}
              onChange={(e) => {
                setRowEditingData((prev) => ({
                  ...prev,
                  [record._id]: { ...prev[record._id], date: e.target.value },
                }))
              }}
              className="w-32 rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          )
        }
        return formatDate(record.date)
      },
    },
    {
      title: '工作日',
      key: 'workday',
      width: 100,
      render: (_, record) => {
        const isRowEditing = rowEditingData[record._id] !== undefined
        const editData = rowEditingData[record._id]
        if (isRowEditing) {
          return (
            <input
              type="text"
              value={editData.workday || ''}
              onChange={(e) => {
                setRowEditingData((prev) => ({
                  ...prev,
                  [record._id]: { ...prev[record._id], workday: e.target.value },
                }))
              }}
              className="w-24 rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="工作日"
            />
          )
        }
        return formatWorkday(record.workday)
      },
    },
    {
      title: '总时长',
      dataIndex: 'totalHours',
      key: 'totalHours',
      width: 80,
      render: (v) => v || '-',
    },
    {
      title: '工作时长',
      key: 'workHours',
      width: 120,
      render: (_, record) => {
        const isRowEditing = rowEditingData[record._id] !== undefined
        const editData = rowEditingData[record._id]
        if (isRowEditing) {
          return (
            <input
              type="text"
              value={editData.totalHours || ''}
              onChange={(e) => {
                setRowEditingData((prev) => ({
                  ...prev,
                  [record._id]: { ...prev[record._id], totalHours: e.target.value },
                }))
              }}
              className="w-20 rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="工作时长"
            />
          )
        }
        return `${record.workHours ?? '-'} (${record.totalHoursDecimal.toFixed(2)}h)`
      },
    },
    {
      title: '签到',
      dataIndex: 'firstClockIn',
      key: 'firstClockIn',
      width: 100,
      render: (v) => v || '-',
    },
    {
      title: '签退',
      dataIndex: 'lastClockOut',
      key: 'lastClockOut',
      width: 100,
      render: (v) => v || '-',
    },
    {
      title: '扣减',
      dataIndex: 'deduction',
      key: 'deduction',
      width: 70,
      render: (v) => v || '-',
    },
    {
      title: '奖励',
      dataIndex: 'reward',
      key: 'reward',
      width: 70,
      render: (v) => v || '-',
    },
    {
      title: '角色',
      key: 'role',
      width: 110,
      render: (_, record) => {
        const isRowEditing = rowEditingData[record._id] !== undefined
        const editData = rowEditingData[record._id]
        if (isRowEditing) {
          return (
            <select
              value={editData.role || 'worker'}
              onChange={(e) => {
                setRowEditingData((prev) => ({
                  ...prev,
                  [record._id]: { ...prev[record._id], role: e.target.value },
                }))
              }}
              className="rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {roles.map((role) => (
                <option key={role} value={role}>
                  {roleMap[role]}
                </option>
              ))}
            </select>
          )
        }
        return (
          <span
            className={`rounded px-2 py-1 text-xs font-medium ${
              record.role === 'worker'
                ? 'bg-blue-100 text-blue-800'
                : record.role === 'forklift'
                  ? 'bg-purple-100 text-purple-800'
                  : 'bg-green-100 text-green-800'
            }`}
          >
            {roleMap[record.role]}
          </span>
        )
      },
    },
    {
      title: '类型',
      key: 'dayType',
      width: 110,
      render: (_, record) => {
        const isRowEditing = rowEditingData[record._id] !== undefined
        const editData = rowEditingData[record._id]
        if (isRowEditing) {
          return (
            <select
              value={
                editData.isPublicHoliday ? 'publicHoliday' : editData.isSorting ? 'sorting' : 'regular'
              }
              onChange={(e) => {
                const type = e.target.value
                setRowEditingData((prev) => ({
                  ...prev,
                  [record._id]: {
                    ...prev[record._id],
                    isPublicHoliday: type === 'publicHoliday',
                    isSorting: type === 'sorting',
                  },
                }))
              }}
              className="rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="regular">不分拣</option>
              <option value="sorting">分拣</option>
              <option value="publicHoliday">公共假期</option>
            </select>
          )
        }
        if (record.isPublicHoliday) {
          return (
            <span className="rounded px-2 py-1 text-xs font-medium bg-orange-100 text-orange-800">
              公共假期
            </span>
          )
        }
        if (record.isSorting) {
          return (
            <span className="rounded px-2 py-1 text-xs font-medium bg-green-100 text-green-800">分拣</span>
          )
        }
        return (
          <span className="rounded px-2 py-1 text-xs font-medium bg-gray-100 text-gray-800">不分拣</span>
        )
      },
    },
    {
      title: '时薪',
      key: 'hourlyRate',
      width: 90,
      align: 'right',
      render: (_, record) => `$${record.hourlyRate.toFixed(2)}`,
    },
    {
      title: '总工资',
      key: 'totalWage',
      width: 100,
      align: 'right',
      render: (_, record) => (
        <span className="font-bold text-green-600">${record.totalWage.toFixed(2)}</span>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 96,
      align: 'center',
      render: (_, record) => {
        const isRowEditing = rowEditingData[record._id] !== undefined
        return (
          <div className="flex items-center justify-center gap-2">
            {isRowEditing ? (
              <>
                <button
                  type="button"
                  onClick={() => saveRowEditing(record._id)}
                  className="text-green-600 hover:text-green-800"
                  title="保存"
                >
                  <Save className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => cancelRowEditing(record._id)}
                  className="text-gray-600 hover:text-gray-800"
                  title="取消"
                >
                  <X className="h-4 w-4" />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => startRowEditing(record)}
                  disabled={!canEditRecord}
                  className="text-blue-600 hover:text-blue-800 disabled:cursor-not-allowed disabled:opacity-40"
                  title={canEditRecord ? '编辑' : '无操作权限'}
                >
                  <Edit2 className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteRecord(record._id)}
                  disabled={!canEditRecord}
                  className="text-red-600 hover:text-red-800 disabled:cursor-not-allowed disabled:opacity-40"
                  title={canEditRecord ? '删除' : '无操作权限'}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        )
      },
    },
  ]

  return (
    <WageAntdTable
      columns={columns}
      dataSource={filteredWageRecords}
      rowKey="_id"
      scrollX={1600}
      rowClassName={(record) => (rowEditingData[record._id] ? 'bg-blue-50' : '')}
      pagination={{
        current: currentPage,
        pageSize,
        total: filteredWageRecords.length,
        showSizeChanger: true,
        pageSizeOptions: [10, 20, 50, 100],
        showTotal: (total) => `共 ${total} 条`,
      }}
      summary={() => (
        <Table.Summary fixed>
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={5} />
            <Table.Summary.Cell index={5} align="right">
              <span className="text-slate-900">当前页总计</span>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={6}>
              <span className="tabular-nums">{pageHoursSum.toFixed(2)}h</span>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={7} colSpan={6} />
            <Table.Summary.Cell index={13} align="right">
              <span className="font-bold text-green-600 tabular-nums">${pageWageSum.toFixed(2)}</span>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={14} />
          </Table.Summary.Row>
        </Table.Summary>
      )}
      onTableChange={(pagination) => {
        if (pagination.pageSize != null && pagination.pageSize !== pageSize) {
          setPageSize(pagination.pageSize)
          setCurrentPage(1)
          return
        }
        setCurrentPage(pagination.current ?? 1)
      }}
    />
  )
}
