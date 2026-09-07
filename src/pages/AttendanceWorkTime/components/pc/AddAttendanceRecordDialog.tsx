import { AutoComplete, Button, Cascader, DatePicker, Form, Input, Modal, Select } from 'antd'
import { useEffect, useMemo } from 'react'
import dayjs, { type Dayjs } from 'dayjs'
import { useTranslation } from 'react-i18next'
import {
  AU_REGIONS,
  buildAttendanceProcessCascaderOptions,
  type AttendanceWorkRecord,
  type AttendanceWorkRecordDraft,
  type AttendanceWorkerSuggestion,
} from '../../attendanceWorkTimeTypes'

type FormValues = {
  process: [string, string]
  workerName: string
  startTime: Dayjs
  endTime: Dayjs
  zoneCode?: string
  notes?: string
  regionCode?: string
}

type Props = {
  open: boolean
  editing: AttendanceWorkRecord | null
  isSuperAdmin: boolean
  ownRegionCode: string | null
  workerSuggestions: AttendanceWorkerSuggestion[]
  workerSearchLoading: boolean
  onSearchWorker: (query: string, regionCodeForSearch: string | null) => void
  onCancel: () => void
  onSubmit: (draft: AttendanceWorkRecordDraft) => Promise<boolean>
}

export function AddAttendanceRecordDialog({
  open,
  editing,
  isSuperAdmin,
  ownRegionCode,
  workerSuggestions,
  workerSearchLoading,
  onSearchWorker,
  onCancel,
  onSubmit,
}: Props) {
  const { t } = useTranslation('attendanceWorkTime')
  const [form] = Form.useForm<FormValues>()
  const processOptions = useMemo(() => buildAttendanceProcessCascaderOptions(t), [t])

  useEffect(() => {
    if (!open) return
    if (editing) {
      form.setFieldsValue({
        process: [editing.processCategory, editing.shift],
        workerName: editing.workerName,
        startTime: dayjs(editing.startTime),
        endTime: editing.endTime ? dayjs(editing.endTime) : dayjs(),
        zoneCode: editing.zoneCode ?? '',
        notes: editing.notes ?? '',
        regionCode: editing.regionCode,
      })
    } else {
      const now = dayjs()
      form.setFieldsValue({
        process: undefined,
        workerName: '',
        startTime: now,
        endTime: now,
        zoneCode: '',
        notes: '',
        regionCode: isSuperAdmin ? undefined : (ownRegionCode ?? undefined),
      })
    }
  }, [open, editing, form, isSuperAdmin, ownRegionCode])

  const handleOk = async () => {
    try {
      const values = await form.validateFields()
      const [processCategory, shift] = values.process
      const draft: AttendanceWorkRecordDraft = {
        regionCode: isSuperAdmin ? values.regionCode : undefined,
        workerName: values.workerName.trim(),
        processCategory,
        shift,
        zoneCode: values.zoneCode?.trim() || null,
        startTime: values.startTime.toISOString(),
        endTime: values.endTime.toISOString(),
        notes: values.notes?.trim() || null,
      }
      const ok = await onSubmit(draft)
      if (ok) form.resetFields()
    } catch {
      /* 表单校验失败，保留在弹窗内 */
    }
  }

  const watchedRegionCode = Form.useWatch('regionCode', form)
  const currentRegionForSearch = isSuperAdmin ? (watchedRegionCode ?? null) : ownRegionCode

  return (
    <Modal
      title={editing ? t('dialog.editTitle') : t('dialog.addTitle')}
      open={open}
      onCancel={onCancel}
      destroyOnHidden
      width={560}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel}>{t('actions.cancel')}</Button>
          <Button type="primary" onClick={() => void handleOk()}>
            {editing ? t('actions.save') : t('actions.add')}
          </Button>
        </div>
      }
    >
      <Form form={form} layout="vertical" className="mt-4">
        {isSuperAdmin ? (
          <Form.Item label={t('dialog.region')} name="regionCode" rules={[{ required: true, message: t('dialog.regionRequired') }]}>
            <Select
              placeholder={t('dialog.regionPlaceholder')}
              options={AU_REGIONS.map((r) => ({ label: r.name, value: r.code }))}
            />
          </Form.Item>
        ) : null}

        <Form.Item label={t('dialog.process')} name="process" rules={[{ required: true, message: t('dialog.processRequired') }]}>
          <Cascader
            options={processOptions}
            expandTrigger="click"
            placeholder={t('dialog.processPlaceholder')}
            displayRender={(labels) => labels[labels.length - 1] ?? ''}
          />
        </Form.Item>

        <Form.Item label={t('dialog.worker')} name="workerName" rules={[{ required: true, message: t('dialog.workerRequired') }]}>
          <AutoComplete
            options={workerSuggestions.map((w) => ({ value: w.name }))}
            onSearch={(q) => onSearchWorker(q, currentRegionForSearch)}
            filterOption={false}
            notFoundContent={workerSearchLoading ? t('dialog.searching') : null}
          >
            <Input placeholder={t('dialog.workerPlaceholder')} allowClear />
          </AutoComplete>
        </Form.Item>

        <div className="grid grid-cols-2 gap-x-4">
          <Form.Item label={t('dialog.startTime')} name="startTime" rules={[{ required: true, message: t('dialog.startTimeRequired') }]}>
            <DatePicker showTime className="w-full" format="YYYY-MM-DD HH:mm" />
          </Form.Item>
          <Form.Item
            label={t('dialog.endTime')}
            name="endTime"
            dependencies={['startTime']}
            rules={[
              { required: true, message: t('dialog.endTimeRequired') },
              {
                validator: async (_, value: Dayjs | undefined) => {
                  const startTime = form.getFieldValue('startTime') as Dayjs | undefined
                  if (value && startTime && !value.isAfter(startTime)) {
                    throw new Error(t('dialog.endTimeAfterStart'))
                  }
                },
              },
            ]}
          >
            <DatePicker showTime className="w-full" format="YYYY-MM-DD HH:mm" />
          </Form.Item>
        </div>

        <Form.Item label={t('dialog.zoneCode')} name="zoneCode">
          <Input placeholder={t('dialog.zoneCodePlaceholder')} allowClear />
        </Form.Item>

        <Form.Item label={t('dialog.notes')} name="notes">
          <Input.TextArea rows={3} placeholder={t('dialog.notesOptional')} allowClear />
        </Form.Item>
      </Form>
    </Modal>
  )
}
