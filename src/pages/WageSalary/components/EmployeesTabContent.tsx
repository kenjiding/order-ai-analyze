// @ts-nocheck
import { Edit2, Save, Trash2, Users, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getDateTimeLocale } from '../../../i18n'
import { useAppLocale } from '../../../i18n/hooks'
import { roleBadgeClassName } from '../constants'

export function EmployeesTabContent({
  employees,
  editingEmployeeId,
  setEditingEmployeeId,
  tempRole,
  setTempRole,
  roles,
  handleUpdateEmployeeRole,
  handleDeleteEmployee,
}) {
  const { t } = useTranslation('wageSalary')
  const { locale } = useAppLocale()
  const dateLocale = getDateTimeLocale(locale)

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">
        {t('employees.title', { count: employees.length })}
      </h3>

      {employees.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>{t('employees.empty')}</p>
          <p className="text-sm mt-1">{t('employees.emptyHint')}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('col.employeeId')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('col.surname')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('col.nickname')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('col.department')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('col.role')}</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{t('col.createdAt')}</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">{t('col.actions')}</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {employees.map((employee) => (
                <tr key={employee._id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm text-gray-900 font-medium">{employee.employeeId}</td>
                  <td className="px-4 py-3 text-sm text-gray-900">{employee.surname || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{employee.nickname || '-'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{employee.department || '-'}</td>
                  <td className="px-4 py-3 text-sm">
                    {editingEmployeeId === employee._id ? (
                      <div className="flex items-center gap-2">
                        <select
                          value={tempRole}
                          onChange={(e) => setTempRole(e.target.value)}
                          className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          {roles.map((role) => (
                            <option key={role} value={role}>
                              {t(`role.${role}`)}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => handleUpdateEmployeeRole(employee._id, tempRole)}
                          className="text-green-600 hover:text-green-800"
                        >
                          <Save className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingEmployeeId(null)}
                          className="text-gray-600 hover:text-gray-800"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-medium ${roleBadgeClassName(employee.role)}`}
                        >
                          {t(`role.${employee.role}`)}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingEmployeeId(employee._id)
                            setTempRole(employee.role)
                          }}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {new Date(employee.createdAt).toLocaleDateString(dateLocale)}
                  </td>
                  <td className="px-4 py-3 text-sm text-center">
                    <button
                      type="button"
                      onClick={() => handleDeleteEmployee(employee)}
                      className="text-red-600 hover:text-red-800 transition-colors"
                      title={t('employees.deleteEmployee')}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
