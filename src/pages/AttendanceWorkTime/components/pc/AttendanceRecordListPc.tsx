import { Button, Empty, Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import { CircleCheckBig, Pencil, Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  attendanceProcessCategoryLabel,
  attendanceShiftLabel,
  formatAttendanceDurationHours,
  type AttendanceWorkRecord,
} from '../../attendanceWorkTimeTypes'

type Props = {
  records: AttendanceWorkRecord[]
  loading: boolean
  onEdit: (record: AttendanceWorkRecord) => void
  onDelete: (record: AttendanceWorkRecord) => void
  /** 一键把当前时间写入结束时间（收工打卡）*/
  onQuickFinish: (record: AttendanceWorkRecord) => void
}

export function AttendanceRecordListPc({ records, loading, onEdit, onDelete, onQuickFinish }: Props) {
  const { t } = useTranslation('attendanceWorkTime')

  const formatTime = (iso: string | null): string =>
    iso ? dayjs(iso).format('MM-DD HH:mm') : t('table.inProgress')

  const columns: ColumnsType<AttendanceWorkRecord> = useMemo(
    () => [
      { title: t('table.worker'), dataIndex: 'workerName', key: 'workerName', width: 120 },
      {
        title: t('table.process'),
        dataIndex: 'processCategory',
        key: 'processCategory',
        width: 100,
        render: (v: string) => attendanceProcessCategoryLabel(v, t),
      },
      {
        title: t('table.shift'),
        dataIndex: 'shift',
        key: 'shift',
        width: 90,
        render: (v: string) => attendanceShiftLabel(v, t),
      },
      {
        title: t('table.startTime'),
        dataIndex: 'startTime',
        key: 'startTime',
        width: 140,
        render: (v: string) => formatTime(v),
      },
      {
        title: t('table.endTime'),
        dataIndex: 'endTime',
        key: 'endTime',
        width: 140,
        render: (v: string | null) => formatTime(v),
      },
      {
        title: t('table.totalDuration'),
        key: 'totalDuration',
        width: 90,
        render: (_, record) => formatAttendanceDurationHours(record.startTime, record.endTime),
      },
      {
        title: t('table.zoneCode'),
        dataIndex: 'zoneCode',
        key: 'zoneCode',
        width: 100,
        render: (v: string | null) => v ?? '—',
      },
      {
        title: t('table.notes'),
        dataIndex: 'notes',
        key: 'notes',
        ellipsis: true,
        render: (v: string | null) => v ?? '—',
      },
      {
        title: t('table.actions'),
        key: 'actions',
        width: 160,
        fixed: 'right',
        render: (_, record) => (
          <div className="flex items-center gap-1">
            <Button
              type="text"
              icon={<CircleCheckBig className="h-4 w-4" aria-hidden />}
              onClick={() => onQuickFinish(record)}
              style={{ color: '#2f8f87' }}
            >
              {t('actions.finish')}
            </Button>
            <Button
              type="text"
              icon={<Pencil className="h-4 w-4" aria-hidden />}
              onClick={() => onEdit(record)}
              aria-label={t('actions.edit')}
            />
            <Button
              type="text"
              danger
              icon={<Trash2 className="h-4 w-4" aria-hidden />}
              onClick={() => onDelete(record)}
              aria-label={t('actions.delete')}
            />
          </div>
        ),
      },
    ],
    [onDelete, onEdit, onQuickFinish, t],
  )

  if (!loading && records.length === 0) {
    return <Empty description={t('table.empty')} className="py-12" />
  }

  return (
    <Table<AttendanceWorkRecord>
      rowKey="id"
      columns={columns}
      dataSource={records}
      loading={loading}
      pagination={{ pageSize: 20, showSizeChanger: false }}
      scroll={{ x: 990 }}
    />
  )
}
