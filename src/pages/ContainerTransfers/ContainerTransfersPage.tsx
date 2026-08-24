import { useState } from 'react'
import { ArrowLeftRight, History, Plus, Repeat } from 'lucide-react'
import { Button } from 'antd'
import { PageSectionTabs } from '../../components/PageSectionTabs'
import type { Transfer } from '../../containerManagement/types'
import { ConfirmReceiptModal } from './components/ConfirmReceiptModal'
import { DisputeReportModal } from './components/DisputeReportModal'
import { TransferChangePanel } from './components/TransferChangePanel'
import { TransferDeleteModal } from './components/TransferDeleteModal'
import { TransferDetailDrawer } from './components/TransferDetailDrawer'
import { TransferFilterBar } from './components/TransferFilterBar'
import { TransferFormModal } from './components/TransferFormModal'
import { TransferTable } from './components/TransferTable'
import { useContainerTransfersPage } from './useContainerTransfersPage'

export default function ContainerTransfersPage() {
  const page = useContainerTransfersPage()
  /** 协商中修改实收申报，与列表的「差异申报」共用同一个弹窗 */
  const [editingReport, setEditingReport] = useState<Transfer | null>(null)

  return (
    <div className="admin-page space-y-5">
      <header className="admin-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#2f8f87]/15 text-[#1f6f68]">
              <ArrowLeftRight className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-950">流转记录</h1>
              <p className="mt-1 max-w-2xl text-sm text-slate-600">
                每次容器移动都记为一笔流转。借出与归还需接收方确认后双方库存才变动；实收与申报不一致时进入协商。
              </p>
            </div>
          </div>
          {page.tab === 'transfers' ? (
            <Button
              type="primary"
              icon={<Plus className="h-4 w-4" aria-hidden />}
              onClick={page.openCreate}
            >
              新增流转记录
            </Button>
          ) : null}
        </div>
      </header>

      <section className="admin-panel overflow-hidden">
        <PageSectionTabs
          activeId={page.tab}
          onChange={(id) => page.setTab(id as 'transfers' | 'changes')}
          items={[
            { id: 'transfers', label: '流转记录', icon: Repeat },
            { id: 'changes', label: '变更记录', icon: History },
          ]}
        />
        <div className="space-y-4 p-4 sm:p-5">
          {page.tab === 'transfers' ? (
            <>
              <TransferFilterBar
                accounts={page.allAccounts}
                filters={page.filters}
                loading={page.loading}
                onApply={page.applyFilters}
              />
              <TransferTable
                transfers={page.transfers}
                loading={page.loading}
                total={page.total}
                page={page.page}
                pageSize={page.pageSize}
                onPageChange={page.setPage}
                canActAs={page.canActAs}
                onConfirm={page.openConfirm}
                onDispute={page.openDispute}
                onDetail={(transfer) => void page.openDetail(transfer)}
                onEdit={page.openEdit}
                onDelete={page.openDelete}
              />
            </>
          ) : (
            <TransferChangePanel
              changes={page.changes}
              total={page.changeTotal}
              page={page.changePage}
              pageSize={page.changePageSize}
              loading={page.changeLoading}
              filters={page.changeFilters}
              onPageChange={page.setChangePage}
              onApply={page.applyChangeFilters}
            />
          )}
        </div>
      </section>

      <TransferFormModal
        open={page.formOpen}
        editing={page.editing}
        ownAccounts={page.ownAccounts}
        counterparties={page.counterparties}
        allAccounts={page.allAccounts}
        submitting={page.submitting}
        onCancel={page.closeForm}
        onSubmit={page.submitTransfer}
      />
      <ConfirmReceiptModal
        key={`confirm-${page.confirmTarget?.id ?? 'none'}`}
        target={page.confirmTarget}
        submitting={page.submitting}
        onCancel={page.closeConfirm}
        onSubmit={page.submitConfirm}
      />
      <DisputeReportModal
        key={`dispute-${page.disputeTarget?.id ?? 'none'}`}
        target={page.disputeTarget}
        submitting={page.submitting}
        onCancel={page.closeDispute}
        onSubmit={page.submitDispute}
      />
      {editingReport ? (
        <DisputeReportModal
          key={`edit-report-${editingReport.id}`}
          target={editingReport}
          isUpdate
          submitting={page.submitting}
          onCancel={() => setEditingReport(null)}
          onSubmit={async (lines, reason, imageUrl, isUpdate, transferId) => {
            const ok = await page.submitDispute(lines, reason, imageUrl, isUpdate, transferId)
            if (ok) setEditingReport(null)
            return ok
          }}
        />
      ) : null}
      <TransferDeleteModal
        key={`delete-${page.deleteTarget?.id ?? 'none'}`}
        target={page.deleteTarget}
        submitting={page.submitting}
        onCancel={page.closeDelete}
        onSubmit={page.submitDelete}
      />
      <TransferDetailDrawer
        detail={page.detail}
        loading={page.detailLoading}
        canActAs={page.canActAs}
        submitting={page.submitting}
        onClose={page.closeDetail}
        onSendMessage={page.sendMessage}
        onEditReport={setEditingReport}
        onAcceptSettlement={(transfer) => void page.submitAcceptSettlement(transfer)}
      />
    </div>
  )
}
