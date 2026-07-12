import { Button as VantButton, Empty as VantEmpty, Tag as VantTag } from 'react-vant'
// react-vant 的 sideEffects glob 在 Vite 依赖预打包下不稳定，显式导入兜底
import 'react-vant/es/empty/style/index.css'
import dayjs from 'dayjs'
import { CircleCheckBig, Pencil, Trash2 } from 'lucide-react'
import { attendanceProcessCategoryLabel, attendanceShiftLabel, type AttendanceWorkRecord } from '../../attendanceWorkTimeTypes'

type Props = {
  records: AttendanceWorkRecord[]
  loading: boolean
  onEdit: (record: AttendanceWorkRecord) => void
  onDelete: (record: AttendanceWorkRecord) => void
  /** 一键把当前时间写入结束时间（收工打卡）；仅未填结束时间的记录展示 */
  onQuickFinish: (record: AttendanceWorkRecord) => void
}

function formatTime(iso: string | null): string {
  return iso ? dayjs(iso).format('MM-DD HH:mm') : '进行中'
}

export function AttendanceRecordListMobile({ records, loading, onEdit, onDelete, onQuickFinish }: Props) {
  if (!loading && records.length === 0) {
    return <VantEmpty description="暂无出勤记录" className="py-12" />
  }
  return (
    <div className="space-y-3 pb-4">
      {records.map((record) => (
        <div key={record.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-base font-semibold text-slate-900">{record.workerName}</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <VantTag color="#e1f5f1" textColor="#1f6f68">
                  {attendanceProcessCategoryLabel(record.processCategory)}
                </VantTag>
                <VantTag color="#eaf4ff" textColor="#25526e">
                  {attendanceShiftLabel(record.shift)}
                </VantTag>
                {record.zoneCode ? <VantTag plain>{record.zoneCode}</VantTag> : null}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <VantButton
                type="primary"
                size="small"
                icon={<CircleCheckBig size={14} aria-hidden />}
                onClick={() => onQuickFinish(record)}
              >
                结束
              </VantButton>
              <VantButton
                plain
                size="small"
                icon={<Pencil size={14} aria-hidden />}
                onClick={() => onEdit(record)}
                aria-label="编辑"
              />
              <VantButton
                plain
                type="danger"
                size="small"
                icon={<Trash2 size={14} aria-hidden />}
                onClick={() => onDelete(record)}
                aria-label="删除"
              />
            </div>
          </div>
          <div className="mt-2 text-sm text-slate-500">
            {formatTime(record.startTime)} ~ {formatTime(record.endTime)}
          </div>
          {record.notes ? <div className="mt-1 text-sm text-slate-400">{record.notes}</div> : null}
        </div>
      ))}
    </div>
  )
}
