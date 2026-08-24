/** 容器管理：主体账户 / 容器台账 / 流转记录 的接口 */
import { Router, type Response } from 'express'
import type { AuthenticatedRequest } from '../auth/middleware'
import {
  canActAsAccount,
  canViewTransfer,
  hasContainerPermission,
  resolveVisibleAccountIds,
  type VisibleAccounts,
} from '../containerManagement/access'
import {
  ContainerBusinessError,
  createAccount,
  deleteAccount,
  listAccountBoundUsers,
  listAccounts,
  listAssignableUsers,
  replaceAccountBoundUsers,
  updateAccount,
} from '../containerManagement/accountService'
import {
  createBalance,
  deleteBalance,
  getBalanceById,
  listBalanceAudits,
  listBalances,
  updateBalance,
} from '../containerManagement/balanceService'
import {
  isAccountKind,
  isContainerType,
  isManualBalanceReasonType,
  isTransferKind,
  isTransferStatus,
  type AccountKind,
  type BalanceReasonType,
  type ContainerType,
  type TransferKind,
  type TransferStatus,
} from '../containerManagement/constants'
import { readImage, saveImageFromDataUrl } from '../containerManagement/imageStorage'
import {
  acceptSettlement,
  addTransferMessage,
  confirmTransfer,
  createTransfer,
  deleteTransfer,
  getTransfer,
  listTransferChanges,
  listTransferMessages,
  listTransfers,
  reportReceipt,
  updateTransfer,
  type TransferLineInput,
} from '../containerManagement/transferService'

export const containerManagementRouter = Router()

const MANAGE_ACCOUNTS = 'btn:container-accounts:manage'
const DELETE_LEDGER = 'btn:container-ledger:delete'

function fail(res: Response, status: number, error: string): void {
  res.status(status).json({ ok: false, error })
}

/** 业务错误按自带状态码返回，其余一律 500，避免把内部异常当成用户输入问题 */
function handleError(res: Response, error: unknown, fallback: string): void {
  if (error instanceof ContainerBusinessError) {
    fail(res, error.status, error.message)
    return
  }
  console.error(`[container-management] ${fallback}`, error)
  fail(res, 500, fallback)
}

function parsePagination(query: Record<string, unknown>): { page: number; pageSize: number } {
  const page = Number.parseInt(String(query.page ?? '1'), 10)
  const pageSize = Number.parseInt(String(query.pageSize ?? '20'), 10)
  return {
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: Number.isFinite(pageSize) && pageSize > 0 ? Math.min(pageSize, 200) : 20,
  }
}

function parseDate(raw: unknown): Date | undefined {
  const value = String(raw ?? '').trim()
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function parseLineItems(raw: unknown): TransferLineInput[] | string {
  if (!Array.isArray(raw) || raw.length === 0) return '至少需要一条流转明细'
  const result: TransferLineInput[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return '流转明细格式不正确'
    const item = entry as { containerType?: unknown; quantity?: unknown }
    if (!isContainerType(item.containerType)) return '品类不合法'
    const quantity = Number(item.quantity)
    if (!Number.isInteger(quantity)) return '数量必须为整数'
    result.push({ containerType: item.containerType, quantity })
  }
  return result
}

// ---------------------------------------------------------------- 主体账户

containerManagementRouter.get('/accounts', async (req: AuthenticatedRequest, res) => {
  try {
    const visible = await resolveVisibleAccountIds(req)
    const counterparty = String(req.query.counterparty ?? '') === '1'
    res.json({ ok: true, data: await listAccounts(visible, counterparty) })
  } catch (error) {
    handleError(res, error, '获取主体账户失败')
  }
})

containerManagementRouter.get('/accounts/assignable-users', async (req: AuthenticatedRequest, res) => {
  if (!hasContainerPermission(req, MANAGE_ACCOUNTS)) return fail(res, 403, '无操作权限')
  try {
    res.json({ ok: true, data: await listAssignableUsers() })
  } catch (error) {
    handleError(res, error, '获取用户列表失败')
  }
})

containerManagementRouter.post('/accounts', async (req: AuthenticatedRequest, res) => {
  if (!hasContainerPermission(req, MANAGE_ACCOUNTS)) return fail(res, 403, '无操作权限')
  const body = req.body as { name?: unknown; kind?: unknown }
  const name = String(body.name ?? '').trim()
  if (!name) return fail(res, 400, '请填写主体名称')
  if (name.length > 200) return fail(res, 400, '主体名称过长')
  if (!isAccountKind(body.kind)) return fail(res, 400, '主体类型不合法')
  try {
    const data = await createAccount({
      name,
      kind: body.kind as AccountKind,
      createdBy: req.authUser?.id ?? null,
    })
    res.status(201).json({ ok: true, data })
  } catch (error) {
    handleError(res, error, '创建主体账户失败')
  }
})

containerManagementRouter.patch('/accounts/:id', async (req: AuthenticatedRequest, res) => {
  if (!hasContainerPermission(req, MANAGE_ACCOUNTS)) return fail(res, 403, '无操作权限')
  const body = req.body as { name?: unknown; kind?: unknown }
  const patch: { name?: string; kind?: AccountKind } = {}
  if (body.name !== undefined) {
    const name = String(body.name).trim()
    if (!name) return fail(res, 400, '主体名称不能为空')
    if (name.length > 200) return fail(res, 400, '主体名称过长')
    patch.name = name
  }
  if (body.kind !== undefined) {
    if (!isAccountKind(body.kind)) return fail(res, 400, '主体类型不合法')
    patch.kind = body.kind as AccountKind
  }
  if (patch.name === undefined && patch.kind === undefined) {
    return fail(res, 400, '未检测到可修改字段')
  }
  try {
    res.json({ ok: true, data: await updateAccount(String(req.params.id ?? '').trim(), patch) })
  } catch (error) {
    handleError(res, error, '更新主体账户失败')
  }
})

containerManagementRouter.delete('/accounts/:id', async (req: AuthenticatedRequest, res) => {
  if (!hasContainerPermission(req, MANAGE_ACCOUNTS)) return fail(res, 403, '无操作权限')
  try {
    await deleteAccount(String(req.params.id ?? '').trim())
    res.json({ ok: true, data: null })
  } catch (error) {
    handleError(res, error, '删除主体账户失败')
  }
})

containerManagementRouter.get('/accounts/:id/users', async (req: AuthenticatedRequest, res) => {
  if (!hasContainerPermission(req, MANAGE_ACCOUNTS)) return fail(res, 403, '无操作权限')
  try {
    res.json({ ok: true, data: await listAccountBoundUsers(String(req.params.id ?? '').trim()) })
  } catch (error) {
    handleError(res, error, '获取绑定用户失败')
  }
})

containerManagementRouter.put('/accounts/:id/users', async (req: AuthenticatedRequest, res) => {
  if (!hasContainerPermission(req, MANAGE_ACCOUNTS)) return fail(res, 403, '无操作权限')
  const body = req.body as { userIds?: unknown }
  if (!Array.isArray(body.userIds)) return fail(res, 400, '请提供用户列表')
  const userIds = body.userIds.map((item) => String(item))
  try {
    await replaceAccountBoundUsers(String(req.params.id ?? '').trim(), userIds)
    res.json({ ok: true, data: await listAccountBoundUsers(String(req.params.id ?? '').trim()) })
  } catch (error) {
    handleError(res, error, '保存绑定关系失败')
  }
})

// ---------------------------------------------------------------- 容器台账

containerManagementRouter.get('/balances', async (req: AuthenticatedRequest, res) => {
  try {
    const visible = await resolveVisibleAccountIds(req)
    res.json({ ok: true, data: await listBalances(visible) })
  } catch (error) {
    handleError(res, error, '获取容器台账失败')
  }
})

containerManagementRouter.post('/balances', async (req: AuthenticatedRequest, res) => {
  const body = req.body as { accountId?: unknown; containerType?: unknown; quantity?: unknown }
  const accountId = String(body.accountId ?? '').trim()
  if (!accountId) return fail(res, 400, '请选择主体账户')
  if (!isContainerType(body.containerType)) return fail(res, 400, '品类不合法')
  const quantity = Number(body.quantity)
  if (!Number.isInteger(quantity) || quantity < 0) return fail(res, 400, '数量必须为 0 或正整数')
  try {
    const visible = await resolveVisibleAccountIds(req)
    if (!canActAsAccount(visible, accountId)) return fail(res, 403, '无权操作该主体账户')
    const data = await createBalance({
      accountId,
      containerType: body.containerType as ContainerType,
      quantity,
      actorUserId: req.authUser?.id ?? null,
      actorIp: req.ip ?? null,
    })
    res.status(201).json({ ok: true, data })
  } catch (error) {
    handleError(res, error, '新增台账记录失败')
  }
})

containerManagementRouter.patch('/balances/:id', async (req: AuthenticatedRequest, res) => {
  const body = req.body as { quantity?: unknown; reasonType?: unknown; reason?: unknown }
  const quantity = Number(body.quantity)
  if (!Number.isInteger(quantity) || quantity < 0) return fail(res, 400, '数量必须为 0 或正整数')
  if (!isManualBalanceReasonType(body.reasonType)) return fail(res, 400, '请选择原因类型')
  const reason = String(body.reason ?? '').trim()
  if (!reason) return fail(res, 400, '请填写变更原因')
  if (reason.length > 500) return fail(res, 400, '变更原因过长')
  try {
    const existing = await getBalanceById(String(req.params.id ?? '').trim())
    if (!existing) return fail(res, 404, '台账记录不存在')
    const visible = await resolveVisibleAccountIds(req)
    if (!canActAsAccount(visible, existing.accountId)) return fail(res, 403, '无权操作该主体账户')
    const data = await updateBalance(String(req.params.id ?? '').trim(), {
      quantity,
      reasonType: body.reasonType as BalanceReasonType,
      reason,
      actorUserId: req.authUser?.id ?? null,
      actorIp: req.ip ?? null,
    })
    res.json({ ok: true, data })
  } catch (error) {
    handleError(res, error, '更新台账记录失败')
  }
})

containerManagementRouter.delete('/balances/:id', async (req: AuthenticatedRequest, res) => {
  if (!hasContainerPermission(req, DELETE_LEDGER)) return fail(res, 403, '无删除台账的权限')
  const body = req.body as { reasonType?: unknown; reason?: unknown }
  if (!isManualBalanceReasonType(body.reasonType)) return fail(res, 400, '请选择原因类型')
  const reason = String(body.reason ?? '').trim()
  if (!reason) return fail(res, 400, '请填写变更原因')
  try {
    const existing = await getBalanceById(String(req.params.id ?? '').trim())
    if (!existing) return fail(res, 404, '台账记录不存在')
    const visible = await resolveVisibleAccountIds(req)
    if (!canActAsAccount(visible, existing.accountId)) return fail(res, 403, '无权操作该主体账户')
    await deleteBalance(String(req.params.id ?? '').trim(), {
      reasonType: body.reasonType as BalanceReasonType,
      reason,
      actorUserId: req.authUser?.id ?? null,
      actorIp: req.ip ?? null,
    })
    res.json({ ok: true, data: null })
  } catch (error) {
    handleError(res, error, '删除台账记录失败')
  }
})

containerManagementRouter.get('/balance-audits', async (req: AuthenticatedRequest, res) => {
  try {
    const visible = await resolveVisibleAccountIds(req)
    const { page, pageSize } = parsePagination(req.query as Record<string, unknown>)
    const accountId = String(req.query.accountId ?? '').trim() || undefined
    if (accountId && !canActAsAccount(visible, accountId)) return fail(res, 403, '无权查看该主体账户')
    const containerTypeRaw = String(req.query.containerType ?? '').trim()
    const data = await listBalanceAudits({
      visibleAccountIds: visible,
      accountId,
      containerType: isContainerType(containerTypeRaw) ? containerTypeRaw : undefined,
      reasonType: String(req.query.reasonType ?? '').trim() || undefined,
      action: String(req.query.action ?? '').trim() || undefined,
      start: parseDate(req.query.start),
      end: parseDate(req.query.end),
      page,
      pageSize,
    })
    res.json({ ok: true, data })
  } catch (error) {
    handleError(res, error, '获取台账变更记录失败')
  }
})

// ---------------------------------------------------------------- 流转记录

containerManagementRouter.get('/transfers', async (req: AuthenticatedRequest, res) => {
  try {
    const visible = await resolveVisibleAccountIds(req)
    const { page, pageSize } = parsePagination(req.query as Record<string, unknown>)
    const statusRaw = String(req.query.status ?? '').trim()
    const data = await listTransfers({
      visibleAccountIds: visible,
      transferId: String(req.query.transferId ?? '').trim() || undefined,
      fromAccountId: String(req.query.fromAccountId ?? '').trim() || undefined,
      toAccountId: String(req.query.toAccountId ?? '').trim() || undefined,
      status: isTransferStatus(statusRaw) ? (statusRaw as TransferStatus) : undefined,
      start: parseDate(req.query.start),
      end: parseDate(req.query.end),
      page,
      pageSize,
    })
    res.json({ ok: true, data })
  } catch (error) {
    handleError(res, error, '获取流转记录失败')
  }
})

containerManagementRouter.get('/transfer-changes', async (req: AuthenticatedRequest, res) => {
  try {
    const visible = await resolveVisibleAccountIds(req)
    const { page, pageSize } = parsePagination(req.query as Record<string, unknown>)
    const data = await listTransferChanges({
      visibleAccountIds: visible,
      transferId: String(req.query.transferId ?? '').trim() || undefined,
      action: String(req.query.action ?? '').trim() || undefined,
      start: parseDate(req.query.start),
      end: parseDate(req.query.end),
      page,
      pageSize,
    })
    res.json({ ok: true, data })
  } catch (error) {
    handleError(res, error, '获取流转变更记录失败')
  }
})

containerManagementRouter.post('/transfers', async (req: AuthenticatedRequest, res) => {
  const body = req.body as {
    kind?: unknown
    fromAccountId?: unknown
    toAccountId?: unknown
    lineItems?: unknown
    imageUrl?: unknown
    note?: unknown
  }
  if (!isTransferKind(body.kind)) return fail(res, 400, '业务类型不合法')
  const fromAccountId = String(body.fromAccountId ?? '').trim()
  const toAccountId = String(body.toAccountId ?? '').trim()
  if (!fromAccountId) return fail(res, 400, '请选择转出方')
  if (!toAccountId) return fail(res, 400, '请选择接收方')
  const lineItems = parseLineItems(body.lineItems)
  if (typeof lineItems === 'string') return fail(res, 400, lineItems)
  const note = body.note === undefined || body.note === null ? null : String(body.note)
  if (note !== null && note.length > 2000) return fail(res, 400, '备注过长')

  try {
    const visible = await resolveVisibleAccountIds(req)
    if (!canActAsAccount(visible, fromAccountId)) {
      return fail(res, 403, '只能以自己绑定的主体账户作为转出方')
    }
    const transferId = await createTransfer({
      kind: body.kind as TransferKind,
      fromAccountId,
      toAccountId,
      lineItems,
      imageUrl: body.imageUrl === undefined ? null : (body.imageUrl as string | null),
      note,
      actorUserId: req.authUser?.id ?? null,
    })
    res.status(201).json({ ok: true, data: await getTransfer(transferId) })
  } catch (error) {
    handleError(res, error, '创建流转记录失败')
  }
})

/** 取出流转并按角色判权：'from' 转出方、'to' 接收方、'any' 参与方 */
async function loadTransferWithRole(
  req: AuthenticatedRequest,
  res: Response,
  role: 'from' | 'to' | 'any',
): Promise<{ transfer: NonNullable<Awaited<ReturnType<typeof getTransfer>>>; visible: VisibleAccounts } | null> {
  const transfer = await getTransfer(String(req.params.id ?? '').trim())
  if (!transfer) {
    fail(res, 404, '流转记录不存在')
    return null
  }
  const visible = await resolveVisibleAccountIds(req)
  const allowed =
    role === 'from'
      ? canActAsAccount(visible, transfer.fromAccountId)
      : role === 'to'
        ? canActAsAccount(visible, transfer.toAccountId)
        : canViewTransfer(visible, transfer)
  if (!allowed) {
    fail(
      res,
      403,
      role === 'from' ? '仅转出方可执行该操作' : role === 'to' ? '仅接收方可执行该操作' : '无权访问该流转记录',
    )
    return null
  }
  return { transfer, visible }
}

containerManagementRouter.get('/transfers/:id', async (req: AuthenticatedRequest, res) => {
  try {
    const loaded = await loadTransferWithRole(req, res, 'any')
    if (!loaded) return
    res.json({
      ok: true,
      data: { ...loaded.transfer, messages: await listTransferMessages(loaded.transfer.id) },
    })
  } catch (error) {
    handleError(res, error, '获取流转详情失败')
  }
})

containerManagementRouter.patch('/transfers/:id', async (req: AuthenticatedRequest, res) => {
  const body = req.body as { lineItems?: unknown; imageUrl?: unknown; note?: unknown; reason?: unknown }
  let lineItems: TransferLineInput[] | undefined
  if (body.lineItems !== undefined) {
    const parsed = parseLineItems(body.lineItems)
    if (typeof parsed === 'string') return fail(res, 400, parsed)
    lineItems = parsed
  }
  if (lineItems === undefined && body.imageUrl === undefined && body.note === undefined) {
    return fail(res, 400, '至少修改一个字段')
  }
  try {
    const loaded = await loadTransferWithRole(req, res, 'from')
    if (!loaded) return
    await updateTransfer({
      transferId: loaded.transfer.id,
      lineItems,
      imageUrl: body.imageUrl === undefined ? undefined : (body.imageUrl as string | null),
      note: body.note === undefined ? undefined : (body.note as string | null),
      reason: body.reason === undefined ? '' : String(body.reason),
      actorUserId: req.authUser?.id ?? null,
    })
    res.json({ ok: true, data: await getTransfer(loaded.transfer.id) })
  } catch (error) {
    handleError(res, error, '修改流转记录失败')
  }
})

containerManagementRouter.delete('/transfers/:id', async (req: AuthenticatedRequest, res) => {
  const reason = String((req.body as { reason?: unknown }).reason ?? '').trim()
  if (!reason) return fail(res, 400, '请填写删除原因')
  if (reason.length > 2000) return fail(res, 400, '删除原因过长')
  try {
    const loaded = await loadTransferWithRole(req, res, 'from')
    if (!loaded) return
    await deleteTransfer({
      transferId: loaded.transfer.id,
      reason,
      actorUserId: req.authUser?.id ?? null,
    })
    res.json({ ok: true, data: null })
  } catch (error) {
    handleError(res, error, '删除流转记录失败')
  }
})

containerManagementRouter.patch('/transfers/:id/confirm', async (req: AuthenticatedRequest, res) => {
  const note = String((req.body as { note?: unknown }).note ?? '')
  if (note.length > 2000) return fail(res, 400, '备注过长')
  try {
    const loaded = await loadTransferWithRole(req, res, 'to')
    if (!loaded) return
    await confirmTransfer({
      transferId: loaded.transfer.id,
      actorUserId: req.authUser?.id ?? null,
      responseNote: note,
    })
    res.json({ ok: true, data: await getTransfer(loaded.transfer.id) })
  } catch (error) {
    handleError(res, error, '确认收货失败')
  }
})

async function handleReceiverReport(
  req: AuthenticatedRequest,
  res: Response,
  isUpdate: boolean,
): Promise<void> {
  const body = req.body as { lineItems?: unknown; reason?: unknown; receiverReportImageUrl?: unknown }
  const parsed = parseLineItems(body.lineItems)
  if (typeof parsed === 'string') return fail(res, 400, parsed)
  const reason = String(body.reason ?? '').trim()
  if (!reason) return fail(res, 400, '请填写原因')
  if (reason.length > 2000) return fail(res, 400, '原因过长')
  try {
    const loaded = await loadTransferWithRole(req, res, 'to')
    if (!loaded) return
    await reportReceipt({
      transferId: loaded.transfer.id,
      lineItems: parsed,
      reason,
      receiverReportImageUrl:
        body.receiverReportImageUrl === undefined
          ? undefined
          : (body.receiverReportImageUrl as string | null),
      isUpdate,
    })
    res.json({ ok: true, data: await getTransfer(loaded.transfer.id) })
  } catch (error) {
    handleError(res, error, isUpdate ? '修改实收申报失败' : '差异申报失败')
  }
}

containerManagementRouter.patch('/transfers/:id/report-receipt', (req: AuthenticatedRequest, res) =>
  handleReceiverReport(req, res, false),
)

containerManagementRouter.patch('/transfers/:id/receiver-report', (req: AuthenticatedRequest, res) =>
  handleReceiverReport(req, res, true),
)

containerManagementRouter.post('/transfers/:id/messages', async (req: AuthenticatedRequest, res) => {
  const body = req.body as { body?: unknown; proposedQuantity?: unknown }
  const text = String(body.body ?? '').trim()
  if (!text) return fail(res, 400, '留言不能为空')
  if (text.length > 4000) return fail(res, 400, '留言过长')
  try {
    const loaded = await loadTransferWithRole(req, res, 'any')
    if (!loaded) return
    await addTransferMessage({
      transferId: loaded.transfer.id,
      actorUserId: req.authUser?.id ?? null,
      body: text,
      proposedQuantity:
        body.proposedQuantity === undefined || body.proposedQuantity === null
          ? null
          : Number(body.proposedQuantity),
    })
    res.status(201).json({ ok: true, data: await listTransferMessages(loaded.transfer.id) })
  } catch (error) {
    handleError(res, error, '发送留言失败')
  }
})

containerManagementRouter.patch('/transfers/:id/accept-settlement', async (req: AuthenticatedRequest, res) => {
  try {
    const loaded = await loadTransferWithRole(req, res, 'from')
    if (!loaded) return
    await acceptSettlement({
      transferId: loaded.transfer.id,
      actorUserId: req.authUser?.id ?? null,
    })
    res.json({ ok: true, data: await getTransfer(loaded.transfer.id) })
  } catch (error) {
    handleError(res, error, '认可结算数量失败')
  }
})

// ---------------------------------------------------------------- 图片

containerManagementRouter.post('/images', async (req: AuthenticatedRequest, res) => {
  const dataUrl = String((req.body as { dataUrl?: unknown }).dataUrl ?? '')
  if (!dataUrl) return fail(res, 400, '请选择图片')
  try {
    res.status(201).json({ ok: true, data: { url: await saveImageFromDataUrl(dataUrl) } })
  } catch (error) {
    handleError(res, error, '上传图片失败')
  }
})

containerManagementRouter.get('/images/:name', async (req: AuthenticatedRequest, res) => {
  try {
    const { buffer, contentType } = await readImage(String(req.params.name ?? '').trim())
    res.setHeader('Content-Type', contentType)
    res.setHeader('Cache-Control', 'private, max-age=86400')
    res.send(buffer)
  } catch (error) {
    handleError(res, error, '读取图片失败')
  }
})
