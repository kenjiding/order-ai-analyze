import { ArrowLeftRight, Download, History, Plus, Repeat, Upload } from 'lucide-react'
import { Button, Space } from 'antd'
import { PageSectionTabs } from '../../components/PageSectionTabs'
import { ConfirmReceiptModal } from './components/ConfirmReceiptModal'
import { DisputeReportModal } from './components/DisputeReportModal'
import { TransferChangePanel } from './components/TransferChangePanel'
import { TransferDeleteModal } from './components/TransferDeleteModal'
import { TransferNegotiateDrawer } from './components/TransferNegotiateDrawer'
import { TransferTimelineDrawer } from './components/TransferTimelineDrawer'
import { TransferFilterBar } from './components/TransferFilterBar'
import { TransferFormModal } from './components/TransferFormModal'
import { TransferImportModal } from './components/TransferImportModal'
import { TransferTable } from './components/TransferTable'
import { useContainerTransfersPage } from './useContainerTransfersPage'

export default function ContainerTransfersPage() {
  const page = useContainerTransfersPage()

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
            <Space>
              <Button
                icon={<Download className="h-4 w-4" aria-hidden />}
                loading={page.templateDownloading}
                onClick={page.downloadImportTemplate}
              >
                下载模板
              </Button>
              <Button
                icon={<Upload className="h-4 w-4" aria-hidden />}
                onClick={page.openImport}
              >
                批量上传
              </Button>
              <Button
                type="primary"
                icon={<Plus className="h-4 w-4" aria-hidden />}
                onClick={page.openCreate}
              >
                新增流转记录
              </Button>
            </Space>
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
                onTimeline={page.openTimeline}
                onNegotiate={page.openNegotiate}
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
      <TransferImportModal
        open={page.importOpen}
        ownAccounts={page.ownAccounts}
        counterparties={page.counterparties}
        submitting={page.submitting}
        templateDownloading={page.templateDownloading}
        onDownloadTemplate={page.downloadImportTemplate}
        onCancel={page.closeImport}
        onSubmit={page.submitImport}
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
      <TransferDeleteModal
        key={`delete-${page.deleteTarget?.id ?? 'none'}`}
        target={page.deleteTarget}
        submitting={page.submitting}
        onCancel={page.closeDelete}
        onSubmit={page.submitDelete}
      />
      <TransferTimelineDrawer
        open={page.drawer === 'timeline'}
        detail={page.detail}
        loading={page.detailLoading}
        onClose={page.closeDrawer}
      />
      <TransferNegotiateDrawer
        open={page.drawer === 'negotiate'}
        detail={page.detail}
        loading={page.detailLoading}
        busy={page.submitting}
        isSender={page.detail ? page.canActAs(page.detail.fromAccountId) : false}
        isReceiver={page.detail ? page.canActAs(page.detail.toAccountId) : false}
        onClose={page.closeDrawer}
        onAcceptSettlement={page.submitAcceptSettlement}
        onUpdateReport={(detail, lines, reason) =>
          page.submitDispute(lines, reason, detail.receiverReportImageUrl, true, detail.id)
        }
      />
    </div>
  )
}
