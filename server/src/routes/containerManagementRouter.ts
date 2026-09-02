/** 容器管理：站点账户 / 容器台账 / 流转记录 的接口 */
import { Router, type Response } from 'express'
import type { AuthenticatedRequest } from '../auth/middleware'
import {
  canActAsAccount,
  canViewTransfer,
  hasContainerPermission,
  listExternalAccountIds,
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
  parseTransferNo,
  type TransferStatus,
} from '../containerManagement/constants'
import { readImage, saveImageFromDataUrl } from '../containerManagement/imageStorage'
import {
  normalizeAccountPushNotify,
  type AccountPushNotify,
} from '../containerManagement/pushNotify'
import {
  acceptSettlement,
  confirmTransfer,
  createTransfersBatch,
  normalizeOccurredAt,
  deleteTransfer,
  getTransfer,
  getTransfersByIds,
  listTransferChanges,
  listTransfers,
  reportReceipt,
  updateTransfer,
  type TransferCreateInput,
  type TransferLineInput,
  type TransferView,
} from '../containerManagement/transferService'
import {
  notifyTransferBatchCreated,
  notifyTransferEvent,
  type TransferNotifyEvent,
} from '../containerManagement/transferNotify'

export const containerManagementRouter = Router()

const MANAGE_ACCOUNTS = 'btn:container-accounts:manage'

/** 代确认是单方改账动作（对方无从知晓也无从反对），独立授权，不随转出方绑定自动获得 */
const PROXY_CONFIRM = 'btn:container-transfers:proxy-confirm'

/** 一次提交的流转组数上限：整批一个事务，太多组会长时间占住行锁 */
const MAX_TRANSFER_BATCH = 20

/** Excel 批量导入的行数上限：同样是单事务整批回滚，200 行是行锁时长可接受的边界 */
const MAX_TRANSFER_IMPORT = 200
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

/**
 * 逐条解析流转创建入参，返回字符串即错误信息（风格同 parseLineItems）。
 * unitLabel 决定错误前缀：手工表单是「第 N 组」，Excel 导入是「第 N 行」。
 */
function parseTransferCreateItems(rawItems: unknown[], unitLabel: string): TransferCreateInput[] | string {
  const parsed: TransferCreateInput[] = []
  for (const [index, raw] of rawItems.entries()) {
    const at = `第 ${index + 1} ${unitLabel}：`
    const item = raw as {
      kind?: unknown
      fromAccountId?: unknown
      toAccountId?: unknown
      lineItems?: unknown
      occurredAt?: unknown
      note?: unknown
    }
    if (!isTransferKind(item.kind)) return `${at}业务类型不合法`
    const fromAccountId = String(item.fromAccountId ?? '').trim()
    const toAccountId = String(item.toAccountId ?? '').trim()
    if (!fromAccountId) return `${at}请选择转出方`
    if (!toAccountId) return `${at}请选择接收方`
    const lineItems = parseLineItems(item.lineItems)
    if (typeof lineItems === 'string') return `${at}${lineItems}`
    const note = item.note === undefined || item.note === null ? null : String(item.note)
    if (note !== null && note.length > 2000) return `${at}备注过长`
    let occurredAt: string
    try {
      occurredAt = normalizeOccurredAt(item.occurredAt)
    } catch (error) {
      return `${at}${error instanceof Error ? error.message : '日期不合法'}`
    }
    parsed.push({ kind: item.kind as TransferKind, fromAccountId, toAccountId, lineItems, occurredAt, note })
  }
  return parsed
}

// ---------------------------------------------------------------- 站点账户

containerManagementRouter.get('/accounts', async (req: AuthenticatedRequest, res) => {
  try {
    // scope=manage：站点账户维护页。改名/删除本就是全局的（只认 MANAGE_ACCOUNTS），
    // 列表若仍按绑定过滤，会出现「列表空却提示已存在同名」的矛盾，故此处读写范围保持一致。
    const manageScope =
      String(req.query.scope ?? '') === 'manage' && hasContainerPermission(req, MANAGE_ACCOUNTS)
    const visible = manageScope ? null : await resolveVisibleAccountIds(req)
    const counterparty = String(req.query.counterparty ?? '') === '1'
    res.json({ ok: true, data: await listAccounts(visible, counterparty) })
  } catch (error) {
    handleError(res, error, '获取站点账户失败')
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
  const body = req.body as {
    name?: unknown
    kind?: unknown
    isExternal?: unknown
    userIds?: unknown
    pushNotify?: unknown
  }
  const name = String(body.name ?? '').trim()
  if (!name) return fail(res, 400, '请填写站点名称')
  if (name.length > 200) return fail(res, 400, '站点名称过长')
  if (!isAccountKind(body.kind)) return fail(res, 400, '站点类型不合法')
  if (body.userIds !== undefined && !Array.isArray(body.userIds)) {
    return fail(res, 400, '绑定用户格式不正确')
  }
  try {
    const data = await createAccount({
      name,
      kind: body.kind as AccountKind,
      isExternal: body.isExternal === true,
      userIds: Array.isArray(body.userIds) ? body.userIds.map((item) => String(item)) : [],
      pushNotify: normalizeAccountPushNotify(body.pushNotify),
      createdBy: req.authUser?.id ?? null,
    })
    res.status(201).json({ ok: true, data })
  } catch (error) {
    handleError(res, error, '创建站点账户失败')
  }
})

containerManagementRouter.patch('/accounts/:id', async (req: AuthenticatedRequest, res) => {
  if (!hasContainerPermission(req, MANAGE_ACCOUNTS)) return fail(res, 403, '无操作权限')
  const body = req.body as {
    name?: unknown
    kind?: unknown
    isExternal?: unknown
    userIds?: unknown
    pushNotify?: unknown
  }
  const patch: {
    name?: string
    kind?: AccountKind
    isExternal?: boolean
    userIds?: string[]
    pushNotify?: AccountPushNotify
  } = {}
  if (body.name !== undefined) {
    const name = String(body.name).trim()
    if (!name) return fail(res, 400, '站点名称不能为空')
    if (name.length > 200) return fail(res, 400, '站点名称过长')
    patch.name = name
  }
  if (body.kind !== undefined) {
    if (!isAccountKind(body.kind)) return fail(res, 400, '站点类型不合法')
    patch.kind = body.kind as AccountKind
  }
  if (body.isExternal !== undefined) {
    patch.isExternal = body.isExternal === true
  }
  if (body.userIds !== undefined) {
    if (!Array.isArray(body.userIds)) return fail(res, 400, '绑定用户格式不正确')
    patch.userIds = body.userIds.map((item) => String(item))
  }
  if (body.pushNotify !== undefined) {
    patch.pushNotify = normalizeAccountPushNotify(body.pushNotify)
  }
  if (Object.keys(patch).length === 0) {
    return fail(res, 400, '未检测到可修改字段')
  }
  try {
    res.json({ ok: true, data: await updateAccount(String(req.params.id ?? '').trim(), patch) })
  } catch (error) {
    handleError(res, error, '更新站点账户失败')
  }
})

containerManagementRouter.delete('/accounts/:id', async (req: AuthenticatedRequest, res) => {
  if (!hasContainerPermission(req, MANAGE_ACCOUNTS)) return fail(res, 403, '无操作权限')
  try {
    await deleteAccount(String(req.params.id ?? '').trim())
    res.json({ ok: true, data: null })
  } catch (error) {
    handleError(res, error, '删除站点账户失败')
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
  if (!accountId) return fail(res, 400, '请选择站点账户')
  if (!isContainerType(body.containerType)) return fail(res, 400, '品类不合法')
  const quantity = Number(body.quantity)
  if (!Number.isInteger(quantity) || quantity < 0) return fail(res, 400, '数量必须为 0 或正整数')
  try {
    const visible = await resolveVisibleAccountIds(req)
    if (!canActAsAccount(visible, accountId)) return fail(res, 403, '无权操作该站点账户')
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
    if (!canActAsAccount(visible, existing.accountId)) return fail(res, 403, '无权操作该站点账户')
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
    if (!canActAsAccount(visible, existing.accountId)) return fail(res, 403, '无权操作该站点账户')
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
    if (accountId && !canActAsAccount(visible, accountId)) return fail(res, 403, '无权查看该站点账户')
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
      transferId: parseTransferNo(req.query.transferId) ?? undefined,
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
      transferId: parseTransferNo(req.query.transferId) ?? undefined,
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
  const rawItems = (req.body as { items?: unknown }).items
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return fail(res, 400, '至少需要一组流转记录')
  }
  if (rawItems.length > MAX_TRANSFER_BATCH) {
    return fail(res, 400, `一次最多提交 ${MAX_TRANSFER_BATCH} 组`)
  }

  const parsed = parseTransferCreateItems(rawItems, '组')
  if (typeof parsed === 'string') return fail(res, 400, parsed)

  try {
    const visible = await resolveVisibleAccountIds(req)
    const external = await listExternalAccountIds(parsed.map((item) => item.fromAccountId))
    for (const [index, item] of parsed.entries()) {
      // 外部方（清关行/客户）登不进系统，他们发起的归还单只能由内部人员代录
      if (!canActAsAccount(visible, item.fromAccountId) && !external.has(item.fromAccountId)) {
        return fail(res, 403, `第 ${index + 1} 组：转出方只能是自己绑定的站点账户或外部方账户`)
      }
    }
    const ids = await createTransfersBatch(parsed, req.authUser?.id ?? null, '组')
    const created = (await Promise.all(ids.map((id) => getTransfer(id)))).filter(
      (item): item is NonNullable<typeof item> => item !== null,
    )
    res.status(201).json({ ok: true, data: created })
    fireTransferBatchNotify(req, created)
  } catch (error) {
    handleError(res, error, '创建流转记录失败')
  }
})

/**
 * Excel 批量导入：与 POST /transfers 同一套校验与事务语义，只是上限更高、错误前缀是「第 N 行」。
 * 飞书推送走 fireTransferBatchNotify，按收件人归并成一条汇总卡，不会逐笔刷屏。
 */
containerManagementRouter.post('/transfers/import', async (req: AuthenticatedRequest, res) => {
  const rawItems = (req.body as { items?: unknown }).items
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return fail(res, 400, '至少需要一行流转记录')
  }
  if (rawItems.length > MAX_TRANSFER_IMPORT) {
    return fail(res, 400, `一次最多导入 ${MAX_TRANSFER_IMPORT} 行`)
  }

  const parsed = parseTransferCreateItems(rawItems, '行')
  if (typeof parsed === 'string') return fail(res, 400, parsed)

  try {
    const visible = await resolveVisibleAccountIds(req)
    const external = await listExternalAccountIds(parsed.map((item) => item.fromAccountId))
    for (const [index, item] of parsed.entries()) {
      if (!canActAsAccount(visible, item.fromAccountId) && !external.has(item.fromAccountId)) {
        return fail(res, 403, `第 ${index + 1} 行：转出方只能是自己绑定的站点账户或外部方账户`)
      }
    }
    const ids = await createTransfersBatch(parsed, req.authUser?.id ?? null, '行')
    res.status(201).json({ ok: true, data: { created: ids.length } })
    fireTransferBatchNotifyByIds(req, ids)
  } catch (error) {
    handleError(res, error, '导入流转记录失败')
  }
})

/** 取出流转并按角色判权：'from' 转出方、'to' 接收方、'any' 参与方 */
async function loadTransferWithRole(
  req: AuthenticatedRequest,
  res: Response,
  role: 'from' | 'to' | 'any',
): Promise<{ transfer: NonNullable<Awaited<ReturnType<typeof getTransfer>>>; visible: VisibleAccounts } | null> {
  const transferId = parseTransferNo(req.params.id)
  if (transferId === null) {
    fail(res, 404, '流转记录不存在')
    return null
  }
  const transfer = await getTransfer(transferId)
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

/**
 * 业务提交成功、响应已发出后再推飞书，通知失败不影响本次接口结果。
 * 收件人是转出方与接收方两个站点各自配置的联系人，见 transferNotify。
 */
function fireTransferNotify(
  req: AuthenticatedRequest,
  transfer: TransferView | null,
  event: TransferNotifyEvent,
  extra: string | null = null,
): void {
  if (!transfer) return
  const actor = req.authUser?.displayName?.trim() || req.authUser?.username || ''
  void notifyTransferEvent(transfer, event, actor, extra)
}

/**
 * 批量新建（导入 / 多组提交）的推送：同样在响应发出后 fire-and-forget。
 * 归并与「几笔以内仍逐笔发」的阈值都在 notifyTransferBatchCreated 里，这里不做判断。
 */
function fireTransferBatchNotify(req: AuthenticatedRequest, transfers: TransferView[]): void {
  if (transfers.length === 0) return
  const actor = req.authUser?.displayName?.trim() || req.authUser?.username || ''
  void notifyTransferBatchCreated(transfers, actor)
}

/**
 * 同上，但流转视图要现取。响应已经发出，所以加载失败也只能记日志，绝不能再往 res 上写。
 */
function fireTransferBatchNotifyByIds(req: AuthenticatedRequest, ids: number[]): void {
  if (ids.length === 0) return
  const actor = req.authUser?.displayName?.trim() || req.authUser?.username || ''
  void getTransfersByIds(ids)
    .then((transfers) => notifyTransferBatchCreated(transfers, actor))
    .catch((error) => {
      console.error(`[container-transfer-notify] 批量 ${ids.length} 笔加载流转失败，已跳过推送`, error)
    })
}

containerManagementRouter.get('/transfers/:id', async (req: AuthenticatedRequest, res) => {
  try {
    const loaded = await loadTransferWithRole(req, res, 'any')
    if (!loaded) return
    res.json({ ok: true, data: loaded.transfer })
  } catch (error) {
    handleError(res, error, '获取流转详情失败')
  }
})

containerManagementRouter.patch('/transfers/:id', async (req: AuthenticatedRequest, res) => {
  const body = req.body as {
    lineItems?: unknown
    occurredAt?: unknown
    note?: unknown
    reason?: unknown
  }
  let lineItems: TransferLineInput[] | undefined
  if (body.lineItems !== undefined) {
    const parsed = parseLineItems(body.lineItems)
    if (typeof parsed === 'string') return fail(res, 400, parsed)
    lineItems = parsed
  }
  if (lineItems === undefined && body.occurredAt === undefined && body.note === undefined) {
    return fail(res, 400, '至少修改一个字段')
  }
  let occurredAt: string | undefined
  if (body.occurredAt !== undefined) {
    try {
      occurredAt = normalizeOccurredAt(body.occurredAt)
    } catch (error) {
      return fail(res, 400, error instanceof Error ? error.message : '日期不合法')
    }
  }
  try {
    const loaded = await loadTransferWithRole(req, res, 'from')
    if (!loaded) return
    await updateTransfer({
      transferId: loaded.transfer.id,
      lineItems,
      occurredAt,
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
    const confirmed = await getTransfer(loaded.transfer.id)
    res.json({ ok: true, data: confirmed })
    fireTransferNotify(req, confirmed, 'confirmed', note.trim() ? `收货备注：${note.trim()}` : null)
  } catch (error) {
    handleError(res, error, '确认收货失败')
  }
})

/**
 * 转出方凭线下回单代确认收货。
 *
 * 仅当接收方在本系统没有账号（isExternal）时开放：他们登不进来，单子否则会永久卡在
 * PENDING_RECEIVER 并一直软占用转出方可用量。账务口径与接收方本人确认完全一致
 * （按申报数量全额入账），差别只在 proxyConfirmed 标记与选填的回单凭证。
 *
 * 少收场景不在这里处理：先按申报数入账，再走台账调整，那条路已经存在。
 */
containerManagementRouter.patch('/transfers/:id/proxy-confirm', async (req: AuthenticatedRequest, res) => {
  if (!hasContainerPermission(req, PROXY_CONFIRM)) return fail(res, 403, '无代确认权限')
  const body = req.body as { note?: unknown; evidenceUrl?: unknown }
  const note = String(body.note ?? '')
  if (note.length > 2000) return fail(res, 400, '备注过长')
  const evidenceUrl = body.evidenceUrl === undefined || body.evidenceUrl === null
    ? null
    : String(body.evidenceUrl).trim() || null
  try {
    const loaded = await loadTransferWithRole(req, res, 'from')
    if (!loaded) return
    if (!loaded.transfer.toAccountIsExternal) {
      return fail(res, 400, '接收方在本系统有账号，请等待对方确认收货')
    }
    await confirmTransfer({
      transferId: loaded.transfer.id,
      actorUserId: req.authUser?.id ?? null,
      responseNote: note,
      proxy: true,
      proxyEvidenceUrl: evidenceUrl,
    })
    const confirmed = await getTransfer(loaded.transfer.id)
    res.json({ ok: true, data: confirmed })
    fireTransferNotify(
      req,
      confirmed,
      'proxyConfirmed',
      note.trim() ? `代确认说明：${note.trim()}` : null,
    )
  } catch (error) {
    handleError(res, error, '代确认收货失败')
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
    const reported = await getTransfer(loaded.transfer.id)
    res.json({ ok: true, data: reported })
    if (!isUpdate) {
      fireTransferNotify(req, reported, 'reported', `申报原因：${reason}`)
    }
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

containerManagementRouter.patch('/transfers/:id/accept-settlement', async (req: AuthenticatedRequest, res) => {
  try {
    const loaded = await loadTransferWithRole(req, res, 'from')
    if (!loaded) return
    await acceptSettlement({
      transferId: loaded.transfer.id,
      actorUserId: req.authUser?.id ?? null,
    })
    const accepted = await getTransfer(loaded.transfer.id)
    res.json({ ok: true, data: accepted })
    // 接收方申报完差异就在等这一下，是协商路径的结清，与「确认收货」同等重要
    fireTransferNotify(req, accepted, 'accepted')
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
