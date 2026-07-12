import { Button, Cascader, DatetimePicker, Field, Popup } from 'react-vant'
// react-vant 的 package.json sideEffects 用 "**/*.css" glob，Vite/esbuild 依赖预打包对该写法支持不稳定，
// 会漏掉部分组件样式（如 cascader），这里显式导入兜底，避免弹出层无样式错乱。
import 'react-vant/es/cascader/style/index.css'
import { useEffect, useState } from 'react'
import dayjs from 'dayjs'
import { showToast } from '../../../../utils/toast'
import {
  ATTENDANCE_PROCESS_VANT_CASCADER_OPTIONS,
  attendanceProcessCategoryLabel,
  attendanceShiftLabel,
  type AttendanceWorkRecord,
  type AttendanceWorkRecordDraft,
  type AttendanceWorkerSuggestion,
} from '../../attendanceWorkTimeTypes'

type Props = {
  open: boolean
  editing: AttendanceWorkRecord | null
  ownRegionCode: string | null
  workerSuggestions: AttendanceWorkerSuggestion[]
  workerSearchLoading: boolean
  onSearchWorker: (query: string, regionCodeForSearch: string | null) => void
  onCancel: () => void
  onSubmit: (draft: AttendanceWorkRecordDraft) => Promise<boolean>
}

function formatDateTime(d: Date | null): string {
  return d ? dayjs(d).format('YYYY-MM-DD HH:mm') : ''
}

export function AttendanceRecordVantPopup({
  open,
  editing,
  ownRegionCode,
  workerSuggestions,
  workerSearchLoading,
  onSearchWorker,
  onCancel,
  onSubmit,
}: Props) {
  const [processValue, setProcessValue] = useState<string[]>([])
  const [processLabel, setProcessLabel] = useState('')
  const [workerName, setWorkerName] = useState('')
  const [startTime, setStartTime] = useState<Date>(new Date())
  const [endTime, setEndTime] = useState<Date | null>(null)
  const [zoneCode, setZoneCode] = useState('')
  const [notes, setNotes] = useState('')

  const [cascaderVisible, setCascaderVisible] = useState(false)
  const [startPickerVisible, setStartPickerVisible] = useState(false)
  const [endPickerVisible, setEndPickerVisible] = useState(false)

  useEffect(() => {
    if (!open) return
    if (editing) {
      setProcessValue([editing.processCategory, editing.shift])
      setProcessLabel(`${attendanceProcessCategoryLabel(editing.processCategory)}${attendanceShiftLabel(editing.shift)}`)
      setWorkerName(editing.workerName)
      setStartTime(new Date(editing.startTime))
      setEndTime(editing.endTime ? new Date(editing.endTime) : null)
      setZoneCode(editing.zoneCode ?? '')
      setNotes(editing.notes ?? '')
    } else {
      setProcessValue([])
      setProcessLabel('')
      setWorkerName('')
      setStartTime(new Date())
      setEndTime(null)
      setZoneCode('')
      setNotes('')
    }
  }, [open, editing])

  const handleSubmit = async () => {
    if (processValue.length < 2) {
      showToast('请选择工序', 'error')
      return
    }
    if (!workerName.trim()) {
      showToast('请输入人员姓名', 'error')
      return
    }
    if (endTime && endTime.getTime() <= startTime.getTime()) {
      showToast('结束时间必须晚于开始时间', 'error')
      return
    }
    const draft: AttendanceWorkRecordDraft = {
      regionCode: ownRegionCode ?? undefined,
      workerName: workerName.trim(),
      processCategory: processValue[0],
      shift: processValue[1],
      zoneCode: zoneCode.trim() || null,
      startTime: startTime.toISOString(),
      endTime: endTime ? endTime.toISOString() : null,
      notes: notes.trim() || null,
    }
    await onSubmit(draft)
  }

  return (
    <Popup
      visible={open}
      position="bottom"
      round
      safeAreaInsetBottom
      onClose={onCancel}
      style={{ maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <span className="text-base font-semibold text-slate-900">{editing ? '编辑出勤工序' : '添加出勤工序'}</span>
        <button type="button" className="text-sm text-slate-400" onClick={onCancel}>
          取消
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <Field
          readOnly
          isLink
          required
          label="工序"
          placeholder="请选择工序 / 班次"
          value={processLabel}
          onClick={() => setCascaderVisible(true)}
        />

        <Field
          label="人员"
          required
          placeholder="输入或选择人员姓名，可直接创建新人员"
          value={workerName}
          onChange={(v) => {
            setWorkerName(v)
            onSearchWorker(v, ownRegionCode)
          }}
        />
        {workerName.trim() && (workerSuggestions.length > 0 || workerSearchLoading) ? (
          <div className="border-b border-slate-100 bg-slate-50 px-4 py-2">
            {workerSearchLoading ? <div className="pb-1 text-xs text-slate-400">搜索中…</div> : null}
            <div className="flex flex-wrap gap-2">
              {workerSuggestions.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600"
                  onClick={() => setWorkerName(w.name)}
                >
                  {w.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <Field
          readOnly
          isLink
          required
          label="开始时间"
          value={formatDateTime(startTime)}
          onClick={() => setStartPickerVisible(true)}
        />
        <Field
          readOnly
          isLink
          label="结束时间"
          placeholder="未填写，可稍后编辑补充"
          value={formatDateTime(endTime)}
          onClick={() => setEndPickerVisible(true)}
        />

        <Field label="负责的区号" placeholder="例如：A1、B3" value={zoneCode} onChange={setZoneCode} />
        <Field type="textarea" label="备注" placeholder="选填" rows={3} autoSize value={notes} onChange={setNotes} />
      </div>

      <div className="border-t border-slate-100 p-3">
        <Button type="primary" block onClick={() => void handleSubmit()}>
          {editing ? '保存' : '添加'}
        </Button>
      </div>

      <Cascader
        popup
        visible={cascaderVisible}
        title="选择工序 / 班次"
        activeColor="#2f8f87"
        options={ATTENDANCE_PROCESS_VANT_CASCADER_OPTIONS}
        value={processValue}
        onFinish={(value, selectedRows) => {
          setProcessValue(value)
          setProcessLabel(String(selectedRows[selectedRows.length - 1]?.text ?? ''))
          setCascaderVisible(false)
        }}
        onClose={() => setCascaderVisible(false)}
      />

      <DatetimePicker
        popup
        type="datetime"
        visible={startPickerVisible}
        title="选择开始时间"
        value={startTime}
        onConfirm={(value: Date) => {
          setStartTime(value)
          setStartPickerVisible(false)
        }}
        onClose={() => setStartPickerVisible(false)}
      />

      <DatetimePicker
        popup
        type="datetime"
        visible={endPickerVisible}
        title="选择结束时间"
        value={endTime ?? startTime}
        onConfirm={(value: Date) => {
          setEndTime(value)
          setEndPickerVisible(false)
        }}
        onClose={() => setEndPickerVisible(false)}
      />
    </Popup>
  )
}
