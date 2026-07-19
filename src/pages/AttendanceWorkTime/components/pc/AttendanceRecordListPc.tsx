import { Button, Empty, Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import { CircleCheckBig, Pencil, Trash2 } from 'lucide-react'
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

function formatTime(iso: string | null): string {
  return iso ? dayjs(iso).format('MM-DD HH:mm') : '进行中'
}

export function AttendanceRecordListPc({ records, loading, onEdit, onDelete, onQuickFinish }: Props) {
  if (!loading && records.length === 0) {
    return <Empty description="暂无出勤记录" className="py-12" />
  }

  const columns: ColumnsType<AttendanceWorkRecord> = [
    { title: '人员', dataIndex: 'workerName', key: 'workerName', width: 120 },
    {
      title: '工序',
      dataIndex: 'processCategory',
      key: 'processCategory',
      width: 100,
      render: (v: string) => attendanceProcessCategoryLabel(v),
    },
    {
      title: '岗位',
      dataIndex: 'shift',
      key: 'shift',
      width: 90,
      render: (v: string) => attendanceShiftLabel(v),
    },
    {
      title: '开始时间',
      dataIndex: 'startTime',
      key: 'startTime',
      width: 140,
      render: (v: string) => formatTime(v),
    },
    {
      title: '结束时间',
      dataIndex: 'endTime',
      key: 'endTime',
      width: 140,
      render: (v: string | null) => formatTime(v),
    },
    {
      title: '总时长',
      key: 'totalDuration',
      width: 90,
      render: (_, record) => formatAttendanceDurationHours(record.startTime, record.endTime),
    },
    { title: '负责区号', dataIndex: 'zoneCode', key: 'zoneCode', width: 100, render: (v: string | null) => v ?? '—' },
    { title: '备注', dataIndex: 'notes', key: 'notes', ellipsis: true, render: (v: string | null) => v ?? '—' },
    {
      title: '操作',
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
            结束
          </Button>
          <Button type="text" icon={<Pencil className="h-4 w-4" aria-hidden />} onClick={() => onEdit(record)} aria-label="编辑" />
          <Button
            type="text"
            danger
            icon={<Trash2 className="h-4 w-4" aria-hidden />}
            onClick={() => onDelete(record)}
            aria-label="删除"
          />
        </div>
      ),
    },
  ]

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
