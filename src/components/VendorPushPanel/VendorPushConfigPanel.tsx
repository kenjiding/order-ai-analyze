import { Button } from 'antd'
import { Plus } from 'lucide-react'
import { useCallback, useState } from 'react'
import type { VendorPushEntry, VendorPushEntryDraft, VendorPushOption } from './vendorPushTypes'
import { VendorPushConfigModal } from './VendorPushConfigModal'
import { VendorPushConfigTable } from './VendorPushConfigTable'

type Props = {
  configs: VendorPushEntry[]
  vendors: VendorPushOption[]
  vendorsLoading: boolean
  loading: boolean
  disabled?: boolean
  onAdd: (draft: VendorPushEntryDraft) => Promise<boolean>
  onEdit: (id: string, draft: VendorPushEntryDraft) => Promise<boolean>
  onDelete: (id: string) => Promise<void>
  onToggleDisabled: (id: string, nextDisabled: boolean) => Promise<void>
}

export function VendorPushConfigPanel({
  configs,
  vendors,
  vendorsLoading,
  loading,
  disabled,
  onAdd,
  onEdit,
  onDelete,
  onToggleDisabled,
}: Props) {
  const [modalOpen, setModalOpen] = useState(false)
  const [editingEntry, setEditingEntry] = useState<VendorPushEntry | null>(null)

  const openCreate = useCallback(() => {
    setEditingEntry(null)
    setModalOpen(true)
  }, [])

  const openEdit = useCallback((entry: VendorPushEntry) => {
    setEditingEntry(entry)
    setModalOpen(true)
  }, [])

  const closeModal = useCallback(() => {
    setModalOpen(false)
    setEditingEntry(null)
  }, [])

  const handleCommit = useCallback(
    async (draft: VendorPushEntryDraft): Promise<boolean> => {
      if (editingEntry) return onEdit(editingEntry.id, draft)
      return onAdd(draft)
    },
    [editingEntry, onAdd, onEdit],
  )

  return (
    <>
      <div className="admin-panel overflow-hidden">
        <div className="admin-section-title flex flex-wrap items-center justify-between gap-3 bg-[var(--admin-surface-soft)]">
          <div>
            <div className="admin-eyebrow">Push Configs</div>
            <h3 className="admin-title mt-0.5 text-base">供应商推送配置</h3>
          </div>
          <Button
            icon={<Plus className="h-4 w-4" />}
            onClick={openCreate}
            disabled={disabled}
          >
            新增推送配置
          </Button>
        </div>

        <VendorPushConfigTable
          configs={configs}
          loading={loading}
          disabled={disabled ?? false}
          onEdit={openEdit}
          onDelete={(entry) => onDelete(entry.id)}
          onToggleDisabled={onToggleDisabled}
        />
      </div>

      <VendorPushConfigModal
        open={modalOpen}
        editing={editingEntry}
        vendors={vendors}
        vendorsLoading={vendorsLoading}
        onCancel={closeModal}
        onCommit={handleCommit}
      />
    </>
  )
}
