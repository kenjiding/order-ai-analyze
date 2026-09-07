import { useState } from 'react'
import { Button, Image, Upload } from 'antd'
import { ImageUp, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { compressCameraPhoto } from '../../DeliveringNotify/compressCameraPhoto'
import { uploadContainerImage } from '../../../containerManagement/api'
import { showToast } from '../../../utils/toast'

type Props = {
  value: string | null
  onChange: (url: string | null) => void
  disabled?: boolean
}

export function TransferImageUpload({ value, onChange, disabled }: Props) {
  const { t } = useTranslation('container')
  const [uploading, setUploading] = useState(false)

  const handleFile = async (file: File) => {
    setUploading(true)
    try {
      const dataUrl = await compressCameraPhoto(file)
      const res = await uploadContainerImage(dataUrl)
      if (!res.ok) {
        showToast(res.error, 'error')
        return
      }
      onChange(res.data.url)
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('transfers.imageProcessFailed'), 'error')
    } finally {
      setUploading(false)
    }
  }

  if (value) {
    return (
      <div className="flex items-center gap-3">
        <Image
          src={value}
          alt={t('transfers.timelineEvidenceAlt')}
          width={96}
          height={72}
          className="rounded-md object-cover"
        />
        {!disabled ? (
          <Button
            type="text"
            danger
            icon={<X className="h-4 w-4" aria-hidden />}
            onClick={() => onChange(null)}
          >
            {t('transfers.imageRemove')}
          </Button>
        ) : null}
      </div>
    )
  }

  return (
    <Upload
      accept="image/*"
      showUploadList={false}
      disabled={disabled || uploading}
      beforeUpload={(file) => {
        void handleFile(file)
        return false
      }}
    >
      <Button icon={<ImageUp className="h-4 w-4" aria-hidden />} loading={uploading} disabled={disabled}>
        {t('transfers.imageSelect')}
      </Button>
    </Upload>
  )
}
