import { Truck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SupplierConfigManager } from './components/SupplierConfigManager'

export default function SupplierConfigPage() {
  const { t } = useTranslation('supplierConfig')

  return (
    <div className="admin-page space-y-5">
      <div className="admin-panel overflow-hidden">
        <div className="admin-section-title bg-[var(--admin-surface-soft)]">
          <div>
            <div className="admin-eyebrow">{t('eyebrow')}</div>
            <h2 className="admin-title mt-1 flex items-center gap-2">
              <Truck className="h-5 w-5 text-[var(--admin-accent)]" aria-hidden />
              {t('title')}
            </h2>
            <p className="mt-1 text-xs text-slate-500">{t('description')}</p>
          </div>
        </div>
        <div className="border-t border-[var(--admin-line)] px-5 py-5">
          <SupplierConfigManager />
        </div>
      </div>
    </div>
  )
}
