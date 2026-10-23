import { useCallback, useState } from 'react'
import { ArrowLeftRight, Download, History, Plus, Repeat, Upload } from 'lucide-react'
import { Button, Space, Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'
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
import { exportTransfersToXlsx } from './exportTransfers'
import { useContainerTransfersPage } from './useContainerTransfersPage'

export default function ContainerTransfersPage() {
  const { t } = useTranslation('container')
  const page = useContainerTransfersPage()
  const noActableAccount = page.ownAccounts.length === 0
  const [exporting, setExporting] = useState(false)

  const handleExport = useCallback(async () => {
    setExporting(true)
    try {
      await exportTransfersToXlsx(page.filters, t)
    } finally {
      setExporting(false)
    }
  }, [page.filters, t])

  return (
    <div className="admin-page space-y-5">
      <header className="admin-panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#2f8f87]/15 text-[#1f6f68]">
              <ArrowLeftRight className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-950">{t('transfers.title')}</h1>
              <p className="mt-1 max-w-2xl text-sm text-slate-600">{t('transfers.subtitle')}</p>
            </div>
          </div>
          {page.tab === 'transfers' ? (
            <Space>
              <Button
                color="cyan"
                variant="solid"
                icon={<Download className="h-4 w-4" aria-hidden />}
                loading={exporting}
                onClick={handleExport}
              >
                {t('transfers.exportDetail')}
              </Button>
              <Tooltip title={noActableAccount ? t('transfers.noAccountHint') : ''}>
                <Button
                  icon={<Upload className="h-4 w-4" aria-hidden />}
                  onClick={page.openImport}
                  disabled={noActableAccount}
                >
                  {t('transfers.batchUpload')}
                </Button>
              </Tooltip>
              <Tooltip title={noActableAccount ? t('transfers.noAccountHint') : ''}>
                <Button
                  type="primary"
                  icon={<Plus className="h-4 w-4" aria-hidden />}
                  onClick={page.openCreate}
                  disabled={noActableAccount}
                >
                  {t('transfers.addTransfer')}
                </Button>
              </Tooltip>
            </Space>
          ) : null}
        </div>
      </header>

      <section className="admin-panel overflow-hidden">
        <PageSectionTabs
          activeId={page.tab}
          onChange={(id) => page.setTab(id as 'transfers' | 'changes')}
          items={[
            { id: 'transfers', label: t('transfers.tabTransfers'), icon: Repeat },
            { id: 'changes', label: t('transfers.tabChanges'), icon: History },
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
                onPageChange={(next, size) => {
                  if (size !== page.pageSize) page.setPageSize(size)
                  page.setPage(size !== page.pageSize ? 1 : next)
                }}
                canActAs={page.canActAs}
                canProxyConfirm={page.canProxyConfirm}
                canVoid={page.canVoid}
                onConfirm={page.openConfirm}
                onProxyConfirm={page.openProxyConfirm}
                onDispute={page.openDispute}
                onTimeline={page.openTimeline}
                onNegotiate={page.openNegotiate}
                onEdit={page.openEdit}
                onDelete={page.openDelete}
                onVoid={page.openVoid}
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
        accounts={page.allAccounts}
        fromAccounts={page.ownAccounts}
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
      <ConfirmReceiptModal
        key={`proxy-confirm-${page.proxyConfirmTarget?.id ?? 'none'}`}
        target={page.proxyConfirmTarget}
        submitting={page.submitting}
        proxy
        onCancel={page.closeProxyConfirm}
        onSubmit={page.submitProxyConfirm}
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
        mode="delete"
        submitting={page.submitting}
        onCancel={page.closeDelete}
        onSubmit={page.submitDelete}
      />
      <TransferDeleteModal
        key={`void-${page.voidTarget?.id ?? 'none'}`}
        target={page.voidTarget}
        mode="void"
        submitting={page.submitting}
        onCancel={page.closeVoid}
        onSubmit={page.submitVoid}
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
