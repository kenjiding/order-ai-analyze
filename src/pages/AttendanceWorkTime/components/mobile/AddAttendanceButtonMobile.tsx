import { Button as VantButton } from 'react-vant'
import { Plus } from 'lucide-react'

type Props = {
  onClick: () => void
}

export function AddAttendanceButtonMobile({ onClick }: Props) {
  return (
    <div className="attendance-work-time-add-bar">
      <VantButton
        type="primary"
        block
        icon={<Plus className="h-4 w-4" aria-hidden />}
        onClick={onClick}
        className="attendance-work-time-add-btn"
      >
        添加出勤工序
      </VantButton>
    </div>
  )
}
