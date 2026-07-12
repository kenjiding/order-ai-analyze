import { Button } from 'antd'
import { Plus } from 'lucide-react'

type Props = {
  onClick: () => void
}

export function AddAttendanceButtonPc({ onClick }: Props) {
  return (
    <Button
      type="primary"
      icon={<Plus className="h-4 w-4" aria-hidden />}
      onClick={onClick}
    >
      添加出勤工序
    </Button>
  )
}
