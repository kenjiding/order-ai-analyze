/** 「查看记录」抽屉：只展示协商时间线，与原系统的 TransferTimelineDrawer 一致 */
import { AdminDrawer } from '../../../components/Drawer/AdminDrawer'
import { formatTransferNo } from '../../../containerManagement/constants'
import type { TransferDetail } from '../../../containerManagement/types'
import { NegotiationTimelinePanel } from './NegotiationTimelinePanel'

type Props = {
  detail: TransferDetail | null
  open: boolean
  loading: boolean
  onClose: () => void
}

export function TransferTimelineDrawer({ detail, open, loading, onClose }: Props) {
  return (
    <AdminDrawer
      open={open}
      onClose={onClose}
      width={520}
      eyebrow={detail ? formatTransferNo(detail.id) : undefined}
      title="协商时间线"
      subtitle={
        detail
          ? `${detail.fromAccountName} → ${detail.toAccountName}`
          : loading
            ? '加载中…'
            : '流转全流程节点'
      }
    >
      <NegotiationTimelinePanel detail={detail} loading={loading} variant="drawer" />
    </AdminDrawer>
  )
}
