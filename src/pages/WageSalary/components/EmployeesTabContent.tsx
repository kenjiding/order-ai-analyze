// @ts-nocheck
import { Edit2, Save, Trash2, Users, X } from 'lucide-react'

export function EmployeesTabContent({
  employees,
  editingEmployeeId,
  setEditingEmployeeId,
  tempRole,
  setTempRole,
  roles,
  roleMap,
  handleUpdateEmployeeRole,
  handleDeleteEmployee,
}) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">员工列表 ({employees.length} 人)</h3>

      {employees.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>暂无员工数据</p>
          <p className="text-sm mt-1">上传打卡文件后将自动创建员工档案</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">人员编号</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">姓氏</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">昵称</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">部门</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">角色</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">创建时间</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">操作</th>
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
                              {roleMap[role]}
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
                          className={`px-3 py-1 rounded-full text-xs font-medium ${
                            employee.role === 'worker'
                              ? 'bg-blue-100 text-blue-800'
                              : employee.role === 'forklift'
                                ? 'bg-purple-100 text-purple-800'
                                : 'bg-green-100 text-green-800'
                          }`}
                        >
                          {roleMap[employee.role]}
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
                    {new Date(employee.createdAt).toLocaleDateString('zh-CN')}
                  </td>
                  <td className="px-4 py-3 text-sm text-center">
                    <button
                      type="button"
                      onClick={() => handleDeleteEmployee(employee)}
                      className="text-red-600 hover:text-red-800 transition-colors"
                      title="删除员工"
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
