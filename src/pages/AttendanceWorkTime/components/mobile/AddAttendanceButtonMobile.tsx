import { Button as VantButton } from 'react-vant'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type Props = {
  onClick: () => void
}

export function AddAttendanceButtonMobile({ onClick }: Props) {
  const { t } = useTranslation('attendanceWorkTime')

  return (
    <div className="attendance-work-time-add-bar">
      <VantButton
        type="primary"
        block
        icon={<Plus className="h-4 w-4" aria-hidden />}
        onClick={onClick}
        className="attendance-work-time-add-btn"
      >
        {t('actions.addProcess')}
      </VantButton>
    </div>
  )
}
