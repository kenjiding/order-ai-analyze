import { useState } from 'react'
import { Alert, Button, Drawer, Image, Input, Upload } from 'antd'
import { ImageUp, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { OrderTrackTimeline, type OrderTrackEvent } from '../../components/OrderTrack/OrderTrackTimeline'
import type { GlobalCountryCode } from '../../stores/globalFilterStore'
import { showToast } from '../../utils/toast'
import { compressCameraPhoto } from '../DeliveringNotify/compressCameraPhoto'
import {
  getAddressVerifyTrackProofImageUrl,
  reportAddressVerifyProblem,
  uploadAddressVerifyProof,
} from './addressVerifyProblemApi'

type ProofImage = { uid: string; previewUrl: string; fileKey: string }

type Props = {
  open: boolean
  orderNo: string
  country: GlobalCountryCode
  imileToken: string
  trackEvents: OrderTrackEvent[]
  onClose: () => void
}

/** AU Post 不可派送问题件人工上报：订单号可改，国家/原因类型/原因固定，描述可改，凭证支持多图；顶部展示该单轨迹。 */
export function ProblemReportDrawer({ open, orderNo, country, imileToken, trackEvents, onClose }: Props) {
  const { t } = useTranslation('addressVerify')
  const [waybillNo, setWaybillNo] = useState(orderNo)
  const [description, setDescription] = useState(t('problemDefaultDescription'))
  const [images, setImages] = useState<ProofImage[]>([])
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleUploadFile = async (file: File) => {
    setUploading(true)
    setError('')
    try {
      const dataUrl = await compressCameraPhoto(file)
      const res = await uploadAddressVerifyProof(dataUrl, file.name, imileToken)
      if (!res.ok) {
        setError(res.error)
        return
      }
      setImages((prev) => [...prev, { uid: `${Date.now()}-${prev.length}`, previewUrl: dataUrl, fileKey: res.data.fileKey }])
    } catch (e) {
      setError(e instanceof Error ? e.message : t('problemUploadFailed'))
    } finally {
      setUploading(false)
    }
  }

  const handleSubmit = async () => {
    if (!waybillNo.trim()) {
      setError(t('problemErrWaybillNo'))
      return
    }
    if (!description.trim()) {
      setError(t('problemErrDescription'))
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const res = await reportAddressVerifyProblem({
        waybillNo: waybillNo.trim(),
        problemCountry: country,
        description: description.trim(),
        proofs: images.map((img) => img.fileKey),
        imileToken,
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      if (!res.data.success) {
        setError(t('problemReportFailed', { reason: res.data.failWaybillNosStr || '' }))
        return
      }
      showToast(t('problemReportSuccess'), 'success')
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Drawer
      title={t('problemDrawerTitle')}
      open={open}
      onClose={onClose}
      width="min(920px, 92vw)"
      destroyOnHidden
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} disabled={submitting}>
            {t('problemCancel')}
          </Button>
          <Button type="primary" loading={submitting} onClick={() => void handleSubmit()}>
            {t('problemSubmit')}
          </Button>
        </div>
      }
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-slate-700">{t('problemWaybillNo')}</span>
            <Input value={waybillNo} onChange={(e) => setWaybillNo(e.target.value)} />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-slate-700">{t('problemCountry')}</span>
            <Input value={country} disabled />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-slate-700">{t('problemReasonType')}</span>
            <Input value={t('problemReasonTypeValue')} disabled />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-slate-700">{t('problemReason')}</span>
            <Input value={t('problemReasonValue')} disabled />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-slate-700">{t('problemDescription')}</span>
            <Input.TextArea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} allowClear />
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-slate-700">{t('problemProof')}</span>
            <div className="flex flex-wrap items-start gap-2">
              {images.map((img) => (
                <div key={img.uid} className="relative">
                  <Image src={img.previewUrl} width={88} height={88} className="rounded-md object-cover" />
                  <button
                    type="button"
                    className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-white text-rose-500 shadow"
                    onClick={() => setImages((prev) => prev.filter((i) => i.uid !== img.uid))}
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </div>
              ))}
              <Upload
                accept="image/*"
                showUploadList={false}
                disabled={uploading}
                beforeUpload={(file) => {
                  void handleUploadFile(file)
                  return false
                }}
              >
                <Button icon={<ImageUp className="h-4 w-4" aria-hidden />} loading={uploading}>
                  {t('problemUploadButton')}
                </Button>
              </Upload>
            </div>
          </div>

          {error ? <Alert type="error" showIcon message={error} /> : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm text-slate-700">{t('problemTrack')}</span>
          <div className="max-h-[640px] overflow-y-auto rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <OrderTrackTimeline
              events={trackEvents}
              getProofImageUrl={(fileKey) => getAddressVerifyTrackProofImageUrl(fileKey, imileToken)}
              emptyText={t('problemTrackEmpty')}
            />
          </div>
        </div>
      </div>
    </Drawer>
  )
}
