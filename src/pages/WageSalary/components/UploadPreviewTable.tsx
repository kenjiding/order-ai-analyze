// @ts-nocheck
import { Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { formatEmployeeDisplayName } from '../employeeDisplayName'
import { WageAntdTable } from './WageAntdTable'

export function UploadPreviewTable({
  uploadedData,
  roles,
  handleUpdateUploadedRole,
  handleDayOptionChange,
  handleDeleteUploadedRow,
  formatDate,
  formatWorkday,
}) {
  const { t } = useTranslation('wageSalary')
  const dataSource = uploadedData.map((record, index) => ({ ...record, rowIndex: index }))

  const columns = useMemo(
    () => [
      {
        title: t('col.employeeId'),
        dataIndex: 'employeeId',
        key: 'employeeId',
        width: 110,
        ellipsis: true,
      },
      {
        title: t('col.displayName'),
        key: 'displayName',
        width: 160,
        ellipsis: true,
        render: (_, record) => formatEmployeeDisplayName(record),
      },
      {
        title: t('col.department'),
        dataIndex: 'department',
        key: 'department',
        width: 100,
        ellipsis: true,
        render: (v) => v || '-',
      },
      {
        title: t('col.date'),
        key: 'date',
        width: 110,
        render: (_, record) => formatDate(record.date),
      },
      {
        title: t('col.workday'),
        key: 'workday',
        width: 90,
        render: (_, record) => formatWorkday(record.workday),
      },
      {
        title: t('col.clockIn'),
        dataIndex: 'firstClockIn',
        key: 'firstClockIn',
        width: 100,
        render: (v) => v || '-',
      },
      {
        title: t('col.clockOut'),
        dataIndex: 'lastClockOut',
        key: 'lastClockOut',
        width: 100,
        render: (v) => v || '-',
      },
      {
        title: t('col.totalHours'),
        dataIndex: 'totalHours',
        key: 'totalHours',
        width: 80,
        render: (v) => v || '-',
      },
      {
        title: t('col.workHours'),
        dataIndex: 'workHours',
        key: 'workHours',
        width: 90,
        render: (v) => v || '-',
      },
      {
        title: t('col.deduction'),
        dataIndex: 'deduction',
        key: 'deduction',
        width: 70,
        render: (v) => v || '-',
      },
      {
        title: t('col.reward'),
        dataIndex: 'reward',
        key: 'reward',
        width: 70,
        render: (v) => v || '-',
      },
      {
        title: t('col.role'),
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
                {t(`role.${role}`)}
              </option>
            ))}
          </select>
        ),
      },
      {
        title: t('col.dayConfig'),
        key: 'weekendOption',
        fixed: 'right',
        width: 130,
        render: (_, record) => (
          <select
            value={record.weekendOption}
            onChange={(e) => handleDayOptionChange(record.rowIndex, e.target.value)}
            className="min-w-[7.5rem] rounded border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[#2f8f87]"
          >
            <option value="publicHoliday">{t('dayType.publicHoliday')}</option>
            <option value="sorting">{t('dayType.sorting')}</option>
            <option value="regularWeekend">{t('dayType.regularWeekend')}</option>
          </select>
        ),
      },
      {
        title: t('col.actions'),
        key: 'actions',
        fixed: 'right',
        width: 72,
        align: 'center',
        render: (_, record) => (
          <button
            type="button"
            onClick={() => handleDeleteUploadedRow(record.rowIndex)}
            className="rounded p-1 text-red-600 hover:bg-red-50 hover:text-red-800"
            aria-label={t('upload.deleteRow')}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ),
      },
    ],
    [t, roles, handleUpdateUploadedRole, handleDayOptionChange, handleDeleteUploadedRow, formatDate, formatWorkday],
  )

  return (
    <WageAntdTable
      columns={columns}
      dataSource={dataSource}
      rowKey="rowIndex"
      scrollX={1500}
    />
  )
}
