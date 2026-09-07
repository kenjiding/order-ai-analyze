import Modal from '../../../components/Modal'
import type { Dispatch, SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import { ROLES } from '../constants'

type RateBand = { workday: number; sortingWeekend: number; publicHoliday: number }
type RateSettings = Record<string, RateBand>

type Props = {
  isOpen: boolean
  onClose: () => void
  actualWorkerRateSettings: RateSettings
  setActualWorkerRateSettings: Dispatch<SetStateAction<RateSettings>>
  persistActualWorkerRateSettings: (settings: RateSettings) => void | Promise<void>
  resetActualWorkerRateSettings: () => void | Promise<void>
}

export function ActualWorkerRatesModal({
  isOpen,
  onClose,
  actualWorkerRateSettings,
  setActualWorkerRateSettings,
  persistActualWorkerRateSettings,
  resetActualWorkerRateSettings,
}: Props) {
  const { t } = useTranslation('wageSalary')

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('actualRates.title')} maxWidth="max-w-2xl">
      <div className="space-y-4 border-b border-slate-100 bg-amber-50/80 px-6 py-4 text-sm leading-6 text-amber-950">
        <p>{t('actualRates.intro')}</p>
      </div>
      <div className="space-y-6 p-6">
        {ROLES.filter((role) => actualWorkerRateSettings[role]).map((role) => (
          <div key={role} className="border-b pb-4 last:border-b-0">
            <h4 className="mb-3 font-medium text-gray-900">{t(`role.${role}`)}</h4>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="mb-1 block text-sm text-gray-600">{t('actualRates.workdayRate')}</label>
                <input
                  type="number"
                  step="0.01"
                  value={actualWorkerRateSettings[role].workday}
                  onChange={(e) =>
                    setActualWorkerRateSettings((prev) => ({
                      ...prev,
                      [role]: { ...prev[role], workday: parseFloat(e.target.value) },
                    }))
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-600">{t('actualRates.sortingWeekendRate')}</label>
                <input
                  type="number"
                  step="0.01"
                  value={actualWorkerRateSettings[role].sortingWeekend}
                  onChange={(e) =>
                    setActualWorkerRateSettings((prev) => ({
                      ...prev,
                      [role]: { ...prev[role], sortingWeekend: parseFloat(e.target.value) },
                    }))
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-600">{t('actualRates.publicHolidayRate')}</label>
                <input
                  type="number"
                  step="0.01"
                  value={actualWorkerRateSettings[role].publicHoliday}
                  onChange={(e) =>
                    setActualWorkerRateSettings((prev) => ({
                      ...prev,
                      [role]: { ...prev[role], publicHoliday: parseFloat(e.target.value) },
                    }))
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between rounded-b-xl border-t border-gray-200 bg-gray-50 px-6 py-4">
        <button
          type="button"
          onClick={resetActualWorkerRateSettings}
          className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 transition-colors hover:bg-gray-100"
        >
          {t('actualRates.resetDefault')}
        </button>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => {
              persistActualWorkerRateSettings(actualWorkerRateSettings)
              onClose()
            }}
            className="rounded-lg bg-green-600 px-4 py-2 text-white transition-colors hover:bg-green-700"
          >
            {t('actualRates.saveSettings')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700"
          >
            {t('actualRates.close')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
