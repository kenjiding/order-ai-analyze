import { Button, Cascader, DatetimePicker, Field, Popup } from 'react-vant'
// react-vant 的 package.json sideEffects 用 "**/*.css" glob，Vite/esbuild 依赖预打包对该写法支持不稳定，
// 会漏掉部分组件样式（如 cascader），这里显式导入兜底，避免弹出层无样式错乱。
import 'react-vant/es/cascader/style/index.css'
import { useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'
import { showToast } from '../../../../utils/toast'
import {
  attendanceProcessCategoryLabel,
  attendanceShiftLabel,
  buildAttendanceProcessVantCascaderOptions,
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
  const { t } = useTranslation('attendanceWorkTime')
  const processOptions = useMemo(() => buildAttendanceProcessVantCascaderOptions(t), [t])
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
      setProcessLabel(
        `${attendanceProcessCategoryLabel(editing.processCategory, t)}${attendanceShiftLabel(editing.shift, t)}`,
      )
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
  }, [open, editing, t])

  const handleSubmit = async () => {
    if (processValue.length < 2) {
      showToast(t('toast.selectProcess'), 'error')
      return
    }
    if (!workerName.trim()) {
      showToast(t('toast.enterWorkerName'), 'error')
      return
    }
    if (endTime && endTime.getTime() <= startTime.getTime()) {
      showToast(t('toast.endTimeAfterStart'), 'error')
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
        <span className="text-base font-semibold text-slate-900">
          {editing ? t('dialog.editTitle') : t('dialog.addTitle')}
        </span>
        <button type="button" className="text-sm text-slate-400" onClick={onCancel}>
          {t('actions.cancel')}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <Field
          readOnly
          isLink
          required
          label={t('dialog.process')}
          placeholder={t('dialog.processPlaceholder')}
          value={processLabel}
          onClick={() => setCascaderVisible(true)}
        />

        <Field
          label={t('dialog.worker')}
          required
          placeholder={t('dialog.workerPlaceholder')}
          value={workerName}
          onChange={(v) => {
            setWorkerName(v)
            onSearchWorker(v, ownRegionCode)
          }}
        />
        {workerName.trim() && (workerSuggestions.length > 0 || workerSearchLoading) ? (
          <div className="border-b border-slate-100 bg-slate-50 px-4 py-2">
            {workerSearchLoading ? <div className="pb-1 text-xs text-slate-400">{t('dialog.searching')}</div> : null}
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
          label={t('dialog.startTime')}
          value={formatDateTime(startTime)}
          onClick={() => setStartPickerVisible(true)}
        />
        <Field
          readOnly
          isLink
          label={t('dialog.endTime')}
          placeholder={t('dialog.endTimeOptionalPlaceholder')}
          value={formatDateTime(endTime)}
          onClick={() => setEndPickerVisible(true)}
        />

        <Field
          label={t('dialog.zoneCode')}
          placeholder={t('dialog.zoneCodePlaceholder')}
          value={zoneCode}
          onChange={setZoneCode}
        />
        <Field
          type="textarea"
          label={t('dialog.notes')}
          placeholder={t('dialog.notesOptional')}
          rows={3}
          autoSize
          value={notes}
          onChange={setNotes}
        />
      </div>

      <div className="border-t border-slate-100 p-3">
        <Button type="primary" block onClick={() => void handleSubmit()}>
          {editing ? t('actions.save') : t('actions.add')}
        </Button>
      </div>

      <Cascader
        popup
        visible={cascaderVisible}
        title={t('dialog.selectProcessCascader')}
        activeColor="#2f8f87"
        options={processOptions}
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
        title={t('dialog.selectStartTime')}
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
        title={t('dialog.selectEndTime')}
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
