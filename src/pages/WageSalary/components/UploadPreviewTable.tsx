// @ts-nocheck
import { Trash2 } from 'lucide-react'
import { formatEmployeeDisplayName } from '../employeeDisplayName'
import { WageAntdTable } from './WageAntdTable'

export function UploadPreviewTable({
  uploadedData,
  roles,
  roleMap,
  handleUpdateUploadedRole,
  handleDayOptionChange,
  handleDeleteUploadedRow,
  formatDate,
  formatWorkday,
}) {
  const dataSource = uploadedData.map((record, index) => ({ ...record, rowIndex: index }))

  const columns = [
    {
      title: '人员编号',
      dataIndex: 'employeeId',
      key: 'employeeId',
      width: 110,
      ellipsis: true,
    },
    {
      title: '姓名/姓氏/昵称',
      key: 'displayName',
      width: 160,
      ellipsis: true,
      render: (_, record) => formatEmployeeDisplayName(record),
    },
    {
      title: '部门',
      dataIndex: 'department',
      key: 'department',
      width: 100,
      ellipsis: true,
      render: (v) => v || '-',
    },
    {
      title: '日期',
      key: 'date',
      width: 110,
      render: (_, record) => formatDate(record.date),
    },
    {
      title: '工作日',
      key: 'workday',
      width: 90,
      render: (_, record) => formatWorkday(record.workday),
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
      title: '总时长',
      dataIndex: 'totalHours',
      key: 'totalHours',
      width: 80,
      render: (v) => v || '-',
    },
    {
      title: '工作时长',
      dataIndex: 'workHours',
      key: 'workHours',
      width: 90,
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
      fixed: 'right',
      width: 120,
      render: (_, record) => (
        <select
          value={record.role}
          onChange={(e) => handleUpdateUploadedRole(record.rowIndex, e.target.value)}
          className="rounded border border-slate-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#2f8f87]"
        >
          {roles.map((role) => (
            <option key={role} value={role}>
              {roleMap[role]}
            </option>
          ))}
        </select>
      ),
    },
    {
      title: '日配置',
      key: 'weekendOption',
      fixed: 'right',
      width: 130,
      render: (_, record) => (
        <select
          value={record.weekendOption}
          onChange={(e) => handleDayOptionChange(record.rowIndex, e.target.value)}
          className="min-w-[7.5rem] rounded border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[#2f8f87]"
        >
          <option value="publicHoliday">公共节假日</option>
          <option value="sorting">分拣</option>
          <option value="regularWeekend">不分拣</option>
        </select>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 72,
      align: 'center',
      render: (_, record) => (
        <button
          type="button"
          onClick={() => handleDeleteUploadedRow(record.rowIndex)}
          className="rounded p-1 text-red-600 hover:bg-red-50 hover:text-red-800"
          aria-label="删除行"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      ),
    },
  ]

  return (
    <WageAntdTable
      columns={columns}
      dataSource={dataSource}
      rowKey="rowIndex"
      scrollX={1500}
    />
  )
}
