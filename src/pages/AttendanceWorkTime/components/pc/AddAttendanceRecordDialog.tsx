import { AutoComplete, Button, Cascader, DatePicker, Form, Input, Modal, Select } from 'antd'
import { useEffect } from 'react'
import dayjs, { type Dayjs } from 'dayjs'
import {
  ATTENDANCE_PROCESS_CASCADER_OPTIONS,
  AU_REGIONS,
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
  const [form] = Form.useForm<FormValues>()

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
      title={editing ? '编辑出勤工序' : '添加出勤工序'}
      open={open}
      onCancel={onCancel}
      destroyOnHidden
      width={560}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" onClick={() => void handleOk()}>
            {editing ? '保存' : '添加'}
          </Button>
        </div>
      }
    >
      <Form form={form} layout="vertical" className="mt-4">
        {isSuperAdmin ? (
          <Form.Item label="州 / 区域" name="regionCode" rules={[{ required: true, message: '请选择州/区域' }]}>
            <Select
              placeholder="请选择记录所属州/区域"
              options={AU_REGIONS.map((r) => ({ label: r.name, value: r.code }))}
            />
          </Form.Item>
        ) : null}

        <Form.Item label="工序" name="process" rules={[{ required: true, message: '请选择工序' }]}>
          <Cascader
            options={ATTENDANCE_PROCESS_CASCADER_OPTIONS}
            expandTrigger="click"
            placeholder="请选择工序 / 班次"
            displayRender={(labels) => labels[labels.length - 1] ?? ''}
          />
        </Form.Item>

        <Form.Item label="人员" name="workerName" rules={[{ required: true, message: '请输入人员姓名' }]}>
          <AutoComplete
            options={workerSuggestions.map((w) => ({ value: w.name }))}
            onSearch={(q) => onSearchWorker(q, currentRegionForSearch)}
            filterOption={false}
            notFoundContent={workerSearchLoading ? '搜索中…' : null}
          >
            <Input placeholder="输入或选择人员姓名，可直接创建新人员" allowClear />
          </AutoComplete>
        </Form.Item>

        <div className="grid grid-cols-2 gap-x-4">
          <Form.Item label="开始时间" name="startTime" rules={[{ required: true, message: '请选择开始时间' }]}>
            <DatePicker showTime className="w-full" format="YYYY-MM-DD HH:mm" />
          </Form.Item>
          <Form.Item
            label="结束时间"
            name="endTime"
            dependencies={['startTime']}
            rules={[
              { required: true, message: '请选择结束时间' },
              {
                validator: async (_, value: Dayjs | undefined) => {
                  const startTime = form.getFieldValue('startTime') as Dayjs | undefined
                  if (value && startTime && !value.isAfter(startTime)) {
                    throw new Error('结束时间必须晚于开始时间')
                  }
                },
              },
            ]}
          >
            <DatePicker showTime className="w-full" format="YYYY-MM-DD HH:mm" />
          </Form.Item>
        </div>

        <Form.Item label="负责的区号" name="zoneCode">
          <Input placeholder="例如：A1、B3" allowClear />
        </Form.Item>

        <Form.Item label="备注" name="notes">
          <Input.TextArea rows={3} placeholder="选填" allowClear />
        </Form.Item>
      </Form>
    </Modal>
  )
}
