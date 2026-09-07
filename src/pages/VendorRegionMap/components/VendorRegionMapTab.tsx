import { useMemo } from 'react'
import { Alert, Button, DatePicker } from 'antd'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'
import { colorFromMap } from '../vendorColors'
import type { useVendorRegionMapPage } from '../useVendorRegionMapPage'
import { VendorRegionMapCanvas } from './VendorRegionMapCanvas'

const nf = new Intl.NumberFormat('en-AU')

type Props = {
  page: ReturnType<typeof useVendorRegionMapPage>
}

export function VendorRegionMapTab({ page }: Props) {
  const { t } = useTranslation('vendorRegionMap')
  const { t: tc } = useTranslation('common')

  const vendors = useMemo(() => {
    const list = [...(page.data?.vendors ?? [])]
    list.sort((a, b) => b.packageCount - a.packageCount)
    return list
  }, [page.data])

  const selectedCount = page.selectedSupplierKeys.length
  const selectedPackages = vendors
    .filter((vendor) => page.selectedSupplierKeys.includes(vendor.supplierKey))
    .reduce((sum, vendor) => sum + vendor.packageCount, 0)

  const datePresets = useMemo(
    () => [
      { label: tc('today'), value: [dayjs().startOf('day'), dayjs().endOf('day')] as [dayjs.Dayjs, dayjs.Dayjs] },
      {
        label: tc('last7Days'),
        value: [dayjs().subtract(6, 'day').startOf('day'), dayjs().endOf('day')] as [dayjs.Dayjs, dayjs.Dayjs],
      },
    ],
    [tc],
  )

  return (
    <div className="space-y-5">
      <section className="admin-panel vrm-head">
        <div className="vrm-head__main">
          <div className="vrm-head__controls">
            <label className="vrm-field">
              <span className="vrm-field__label">{t('statDate')}</span>
              <DatePicker.RangePicker
                value={page.dateRange}
                onChange={(values) => {
                  if (values?.[0] && values[1]) page.setDateRange([values[0], values[1]])
                }}
                format="YYYY-MM-DD"
                inputReadOnly
                allowClear={false}
                presets={datePresets}
              />
            </label>
            <Button type="primary" loading={page.loading} onClick={() => void page.query()}>
              {t('query')}
            </Button>
          </div>
        </div>
      </section>

      {page.error ? <Alert type="error" showIcon message={page.error} /> : null}

      <section className="admin-panel vrm-vendors">
        <div className="vrm-vendors__head">
          <div>
            <h2 className="vrm-vendors__title">{t('vendorFilter')}</h2>
            <p className="vrm-vendors__meta">
              {vendors.length > 0
                ? t('selectedCoverage', {
                    selected: selectedCount,
                    total: vendors.length,
                    parcels: nf.format(selectedPackages),
                  })
                : t('queryHint')}
            </p>
          </div>
          <div className="vrm-vendors__actions">
            <Button onClick={() => page.selectAllVendors()} disabled={vendors.length === 0}>
              {t('selectAll')}
            </Button>
            <Button onClick={() => page.invertVendorSelection()} disabled={vendors.length === 0}>
              {t('invertSelection')}
            </Button>
          </div>
        </div>

        {page.loading && vendors.length === 0 ? (
          <div className="vrm-skeleton-chips" aria-hidden>
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="vrm-skeleton-chip" />
            ))}
          </div>
        ) : vendors.length === 0 ? (
          <div className="vrm-empty">
            <div className="vrm-empty__title">{t('noVendorsTitle')}</div>
            <div className="vrm-empty__hint">{t('noVendorsHint')}</div>
          </div>
        ) : (
          <div className="vrm-vendors__grid">
            {vendors.map((vendor) => {
              const color = colorFromMap(page.vendorColorMap, vendor.supplierKey)
              const checked = page.selectedSupplierKeys.includes(vendor.supplierKey)
              return (
                <button
                  key={vendor.supplierKey}
                  type="button"
                  className="vrm-vendor"
                  aria-pressed={checked}
                  onClick={() => page.toggleVendor(vendor.supplierKey, !checked)}
                  title={t('vendorTooltip', {
                    name: `${vendor.supplierName}${vendor.vendorCode ? `（${vendor.vendorCode}）` : ''}`,
                    count: nf.format(vendor.packageCount),
                    zips: vendor.zipCount,
                  })}
                >
                  <span className="vrm-swatch" style={{ background: color }} aria-hidden />
                  <span className="vrm-vendor__name">{vendor.supplierName}</span>
                  <span className="vrm-vendor__count">{nf.format(vendor.packageCount)}</span>
                </button>
              )
            })}
          </div>
        )}
      </section>

      <section className="admin-panel overflow-hidden">
        <VendorRegionMapCanvas
          data={page.data}
          loading={page.loading}
          selectedSupplierKeys={page.selectedSupplierKeys}
          colorMap={page.vendorColorMap}
        />
      </section>
    </div>
  )
}
