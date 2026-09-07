import Modal from '../../../components/Modal'
import type { Dispatch, SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import { ROLES } from '../constants'

type RateBand = { workday: number; sortingWeekend: number; publicHoliday: number }
type RateSettings = Record<string, RateBand>

type Props = {
  isOpen: boolean
  onClose: () => void
  rateSettings: RateSettings
  setRateSettings: Dispatch<SetStateAction<RateSettings>>
  persistRateSettings: (settings: RateSettings) => void | Promise<void>
  resetRateSettings: () => void | Promise<void>
}

export function RateSettingsModal({
  isOpen,
  onClose,
  rateSettings,
  setRateSettings,
  persistRateSettings,
  resetRateSettings,
}: Props) {
  const { t } = useTranslation('wageSalary')

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('rateSettings.title')} maxWidth="max-w-2xl">
      <div className="p-6 space-y-6">
        {ROLES.filter((role) => rateSettings[role]).map((role) => (
          <div key={role} className="border-b pb-4 last:border-b-0">
            <h4 className="font-medium text-gray-900 mb-3">{t(`role.${role}`)}</h4>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">{t('rateSettings.workdayRate')}</label>
                <input
                  type="number"
                  step="0.01"
                  value={rateSettings[role].workday}
                  onChange={(e) =>
                    setRateSettings((prev) => ({
                      ...prev,
                      [role]: { ...prev[role], workday: parseFloat(e.target.value) },
                    }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">{t('rateSettings.sortingWeekendRate')}</label>
                <input
                  type="number"
                  step="0.01"
                  value={rateSettings[role].sortingWeekend}
                  onChange={(e) =>
                    setRateSettings((prev) => ({
                      ...prev,
                      [role]: { ...prev[role], sortingWeekend: parseFloat(e.target.value) },
                    }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">{t('rateSettings.publicHolidayRate')}</label>
                <input
                  type="number"
                  step="0.01"
                  value={rateSettings[role].publicHoliday}
                  onChange={(e) =>
                    setRateSettings((prev) => ({
                      ...prev,
                      [role]: { ...prev[role], publicHoliday: parseFloat(e.target.value) },
                    }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-xl flex justify-between items-center">
        <button
          type="button"
          onClick={resetRateSettings}
          className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
        >
          {t('rateSettings.resetDefault')}
        </button>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => {
              persistRateSettings(rateSettings)
              onClose()
            }}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
          >
            {t('rateSettings.saveSettings')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            {t('rateSettings.close')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
