import { Button } from 'antd'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

type Props = {
  onClick: () => void
}

export function AddAttendanceButtonPc({ onClick }: Props) {
  const { t } = useTranslation('attendanceWorkTime')

  return (
    <Button type="primary" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={onClick}>
      {t('actions.addProcess')}
    </Button>
  )
}
