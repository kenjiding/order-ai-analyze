import { Col, Form, Input, Row, Select, Switch, Typography } from 'antd'
import { ShieldCheck, UserRound } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { AdminDrawer } from '../../../components/Drawer/AdminDrawer'
import '../systemUsers.css'
import type { AdminUser, PermissionDefinition } from '../../../api/adminUsersApi'
import type { RegionOption } from '../../../api/authApi'
import PermissionCheckboxGroup from './PermissionCheckboxGroup'

export type UserFormValues = {
  regionCode: string
  username: string
  password: string
  displayName: string
  isActive: boolean
  permissionKeys: string[]
}

type UserFormModalProps = {
  open: boolean
  saving: boolean
  editingUser: AdminUser | null
  regions: RegionOption[]
  menuPermissions: PermissionDefinition[]
  buttonPermissions: PermissionDefinition[]
  onCancel: () => void
  onSubmit: (values: UserFormValues) => Promise<void>
}

function FormSection({
  title,
  description,
  icon,
  children,
}: {
  title: string
  description: string
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <section className="su-form-section">
      <div className="su-form-section-head">
        <div className="su-form-section-icon">{icon}</div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[var(--admin-text)]">{title}</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-[var(--admin-muted)]">{description}</p>
        </div>
      </div>
      <div className="su-form-section-body">{children}</div>
    </section>
  )
}

export default function UserFormModal({
  open,
  saving,
  editingUser,
  regions,
  menuPermissions,
  buttonPermissions,
  onCancel,
  onSubmit,
}: UserFormModalProps) {
  const [form] = Form.useForm<UserFormValues>()
  const isEdit = Boolean(editingUser)
  const isSuperAdmin = editingUser?.role === 'super_admin'

  useEffect(() => {
    if (!open) return
    if (editingUser) {
      form.setFieldsValue({
        regionCode: editingUser.regionCode ?? regions[0]?.code ?? 'NSW',
        username: editingUser.username,
        password: '',
        displayName: editingUser.displayName ?? '',
        isActive: editingUser.isActive,
        permissionKeys: editingUser.permissions.includes('*') ? [] : editingUser.permissions,
      })
      return
    }
    form.setFieldsValue({
      regionCode: regions[0]?.code ?? 'NSW',
      username: '',
      password: '',
      displayName: '',
      isActive: true,
      permissionKeys: [],
    })
  }, [open, editingUser, form, regions])

  const handleSubmit = () => {
    void form.validateFields().then((values) => onSubmit(values))
  }

  const drawerTitle = isEdit ? '编辑用户' : '新建用户'
  const drawerEyebrow = isEdit ? 'Edit User' : 'New User'

  return (
    <AdminDrawer
      className="system-users-drawer"
      open={open}
      onClose={onCancel}
      title={drawerTitle}
      eyebrow={drawerEyebrow}
      closeAriaLabel={isEdit ? '关闭编辑用户' : '关闭新建用户'}
      width={Math.min(960, typeof window !== 'undefined' ? window.innerWidth - 32 : 960)}
      destroyOnHidden
      footer={
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onCancel} className="admin-btn px-4 py-2">
            取消
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleSubmit}
            className="admin-btn admin-btn-primary px-5 py-2 disabled:opacity-60"
          >
            {saving ? '保存中…' : isEdit ? '保存修改' : '创建用户'}
          </button>
        </div>
      }
      styles={{
        body: { padding: '20px 24px 8px', background: '#f8fafb' },
        footer: { padding: '12px 24px', background: '#fff', borderTop: '1px solid #e2e8f0' },
      }}
    >
      <Form form={form} layout="vertical" requiredMark={false} className="space-y-4">
        <FormSection
          title="账号信息"
          description="用户名全系统唯一；创建时选择所属州/区域。密码至少 8 位。"
          icon={<UserRound className="h-4 w-4" aria-hidden />}
        >
          <Row gutter={[16, 0]}>
            <Col xs={24} md={12}>
              <Form.Item
                name="regionCode"
                label={<span className="text-xs font-semibold text-slate-600">州 / 区域</span>}
                rules={[{ required: true, message: '请选择州/区域' }]}
              >
                <Select
                  disabled={isEdit || isSuperAdmin}
                  options={regions.map((region) => ({
                    value: region.code,
                    label: region.name,
                  }))}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="username"
                label={<span className="text-xs font-semibold text-slate-600">用户名</span>}
                rules={[
                  { required: true, message: '请输入用户名' },
                  { min: 2, message: '至少 2 个字符' },
                  { max: 64, message: '最多 64 个字符' },
                  { pattern: /^[\w.-]+$/, message: '仅支持字母、数字、下划线、点、连字符' },
                ]}
              >
                <Input placeholder="登录用户名" />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="password"
                label={
                  <span className="text-xs font-semibold text-slate-600">
                    {isEdit ? '新密码' : '登录密码'}
                    {isEdit ? (
                      <Typography.Text type="secondary" className="ml-1 font-normal">
                        （留空不修改）
                      </Typography.Text>
                    ) : null}
                  </span>
                }
                rules={isEdit ? [] : [{ required: true, message: '请输入密码' }, { min: 8, message: '至少 8 位' }]}
              >
                <Input.Password placeholder={isEdit ? '留空则不修改' : '至少 8 位'} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="displayName"
                label={<span className="text-xs font-semibold text-slate-600">显示名称</span>}
              >
                <Input placeholder="可选，用于顶栏展示" />
              </Form.Item>
            </Col>
            {isEdit ? (
              <Col xs={24} md={12}>
                <Form.Item
                  label={<span className="text-xs font-semibold text-slate-600">账号状态</span>}
                  className="mb-0"
                >
                  <div className="flex h-10 items-center justify-between rounded-lg border border-slate-200 bg-slate-50/80 px-3">
                    <span className="text-sm text-slate-700">{isSuperAdmin ? '超级管理员始终启用' : '启用此账号'}</span>
                    <Form.Item name="isActive" valuePropName="checked" noStyle>
                      <Switch disabled={isSuperAdmin} />
                    </Form.Item>
                  </div>
                </Form.Item>
              </Col>
            ) : null}
          </Row>
        </FormSection>

        {isSuperAdmin ? (
          <FormSection
            title="权限范围"
            description="超级管理员默认拥有全部菜单与按钮权限。"
            icon={<ShieldCheck className="h-4 w-4" aria-hidden />}
          >
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/80 px-4 py-6 text-center text-sm text-slate-500">
              该角色无需单独配置权限。
            </div>
          </FormSection>
        ) : (
          <FormSection
            title="权限配置"
            description="菜单决定可见模块；按钮决定页面内关键操作。"
            icon={<ShieldCheck className="h-4 w-4" aria-hidden />}
          >
            <Form.Item name="permissionKeys" className="mb-0">
              <PermissionCheckboxGroup
                menuPermissions={menuPermissions}
                buttonPermissions={buttonPermissions}
              />
            </Form.Item>
          </FormSection>
        )}
      </Form>
    </AdminDrawer>
  )
}
