import { useEffect, useState } from 'react'
import { App, Alert, Button, DatePicker, Input, Modal, Select } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'
import { useTranslation } from 'react-i18next'
import { createDispatchPerformanceException } from '../dispatchPerformanceApi'
import type {
  DispatchPerformanceExceptionDraft,
  DispatchPerformanceSupplierOption,
} from '../dispatchPerformanceTypes'

const { TextArea } = Input

type Props = {
  open: boolean
  onClose: () => void
  configId: string
  supplierOptions: DispatchPerformanceSupplierOption[]
  /** 从表格行内点开时带入的上下文；面板顶部「+ 新增报备」打开时为空，全部手工填 */
  defaults?: Partial<DispatchPerformanceExceptionDraft>
  onCreated: () => void
}

function parseWaybillNosInput(text: string): string[] {
  return [...new Set(text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean))]
}

/**
 * 新增异常报备的表单。不校验运单号是否真的「未签收」——报备时刻通常早于结算
 * （事故当天就要报，派签要 D+2 才结算），此时数据可能还不存在。是否生效交给
 * 查询侧的交集逻辑，结算跑完后自动生效。
 */
export function DispatchExceptionModal({
  open,
  onClose,
  configId,
  supplierOptions,
  defaults,
  onCreated,
}: Props) {
  const { t } = useTranslation(['dispatchPerformance', 'common'])
  const { message } = App.useApp()

  const [date, setDate] = useState<Dayjs>(dayjs())
  const [supplierKey, setSupplierKey] = useState('')
  const [routeCode, setRouteCode] = useState('')
  const [courierCode, setCourierCode] = useState('')
  const [waybillText, setWaybillText] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDate(defaults?.arrivalDate ? dayjs(defaults.arrivalDate) : dayjs())
    setSupplierKey(defaults?.supplierKey ?? '')
    setRouteCode(defaults?.routeCode ?? '')
    setCourierCode(defaults?.courierCode ?? '')
    setWaybillText('')
    setReason('')
    setError(null)
  }, [open, defaults])

  const handleSubmit = async () => {
    if (!date) return setError(t('exception.validation.date', { ns: 'dispatchPerformance' }))
    if (!supplierKey) return setError(t('exception.validation.supplier', { ns: 'dispatchPerformance' }))
    if (!routeCode.trim()) return setError(t('exception.validation.route', { ns: 'dispatchPerformance' }))
    if (!courierCode.trim()) return setError(t('exception.validation.courier', { ns: 'dispatchPerformance' }))
    const waybillNos = parseWaybillNosInput(waybillText)
    if (waybillNos.length === 0) {
      return setError(t('exception.validation.waybillNos', { ns: 'dispatchPerformance' }))
    }
    if (!reason.trim()) return setError(t('exception.validation.reason', { ns: 'dispatchPerformance' }))

    setSaving(true)
    setError(null)
    try {
      await createDispatchPerformanceException(configId, {
        arrivalDate: date.format('YYYY-MM-DD'),
        supplierKey,
        routeCode: routeCode.trim(),
        courierCode: courierCode.trim(),
        waybillNos,
        reason: reason.trim(),
      })
      message.success(t('exception.createSuccess', { ns: 'dispatchPerformance' }))
      onCreated()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('exception.createError', { ns: 'dispatchPerformance' }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={t('exception.modalTitle', { ns: 'dispatchPerformance' })}
      destroyOnHidden
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={saving}>
            {t('exception.cancel', { ns: 'dispatchPerformance' })}
          </Button>
          <Button type="primary" onClick={() => void handleSubmit()} loading={saving}>
            {t('exception.submit', { ns: 'dispatchPerformance' })}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 pt-2">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500">
              {t('exception.fieldDate', { ns: 'dispatchPerformance' })}
            </div>
            <DatePicker
              value={date}
              onChange={(val) => val && setDate(val)}
              allowClear={false}
              className="w-full"
              disabled={saving}
            />
          </div>
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500">
              {t('exception.fieldSupplier', { ns: 'dispatchPerformance' })}
            </div>
            <Select
              value={supplierKey || undefined}
              onChange={setSupplierKey}
              className="w-full"
              disabled={saving}
              options={supplierOptions.map((s) => ({ label: s.supplierName, value: s.supplierKey }))}
            />
          </div>
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500">
              {t('exception.fieldRoute', { ns: 'dispatchPerformance' })}
            </div>
            <Input
              value={routeCode}
              onChange={(e) => setRouteCode(e.target.value)}
              placeholder={t('exception.fieldRoutePlaceholder', { ns: 'dispatchPerformance' })}
              disabled={saving}
            />
          </div>
          <div className="space-y-1">
            <div className="text-xs font-medium text-slate-500">
              {t('exception.fieldCourier', { ns: 'dispatchPerformance' })}
            </div>
            <Input
              value={courierCode}
              onChange={(e) => setCourierCode(e.target.value)}
              placeholder={t('exception.fieldCourierPlaceholder', { ns: 'dispatchPerformance' })}
              disabled={saving}
            />
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-xs font-medium text-slate-500">
            {t('exception.fieldWaybillNos', { ns: 'dispatchPerformance' })}
          </div>
          <TextArea
            value={waybillText}
            onChange={(e) => setWaybillText(e.target.value)}
            placeholder={t('exception.fieldWaybillNosPlaceholder', { ns: 'dispatchPerformance' })}
            autoSize={{ minRows: 3, maxRows: 8 }}
            disabled={saving}
          />
        </div>
        <div className="space-y-1">
          <div className="text-xs font-medium text-slate-500">
            {t('exception.fieldReason', { ns: 'dispatchPerformance' })}
          </div>
          <TextArea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t('exception.fieldReasonPlaceholder', { ns: 'dispatchPerformance' })}
            autoSize={{ minRows: 2, maxRows: 4 }}
            disabled={saving}
          />
        </div>
        {error ? <Alert type="error" showIcon message={error} /> : null}
      </div>
    </Modal>
  )
}
