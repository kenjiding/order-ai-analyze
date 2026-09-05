/** 容器管理权限边界：转出方判定与流转可见性 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canActAsAccount, canViewTransfer, findUnactableFromAccount } from './access'

const GZ = 'gz-warehouse'
const SZ = 'sz-warehouse'
const BROKER = 'huaqiang-broker'

test('超管（actable=null）不限转出方', () => {
  assert.equal(findUnactableFromAccount(null, [{ fromAccountId: SZ }], '组'), null)
})

test('转出方是自己绑定的站点则放行，内部仓库与外部方一视同仁', () => {
  assert.equal(
    findUnactableFromAccount([GZ, BROKER], [{ fromAccountId: GZ }, { fromAccountId: BROKER }], '组'),
    null,
  )
})

test('转出方不是自己绑定的站点则拒绝，错误信息带组序号', () => {
  const message = findUnactableFromAccount(
    [GZ],
    [{ fromAccountId: GZ }, { fromAccountId: SZ }],
    '组',
  )
  assert.equal(message, '第 2 组：无权以该站点作为转出方，请选择自己绑定的站点')
})

test('导入场景的错误前缀是「行」', () => {
  assert.match(findUnactableFromAccount([GZ], [{ fromAccountId: SZ }], '行') ?? '', /^第 1 行：/)
})

test('一个站点都没绑定时任何转出方都不合法', () => {
  assert.notEqual(findUnactableFromAccount([], [{ fromAccountId: GZ }], '组'), null)
})

test('可见范围（读）比可操作范围（写）宽：只看得到不等于能当转出方', () => {
  const transfer = { fromAccountId: SZ, toAccountId: BROKER }
  // view-all 用户的可见范围是 null，看得到这笔
  assert.equal(canViewTransfer(null, transfer), true)
  // 但他没绑定任何站点，可操作范围是空的，不能以 SZ 名义建单
  assert.equal(canActAsAccount([], SZ), false)
  assert.notEqual(findUnactableFromAccount([], [{ fromAccountId: SZ }], '组'), null)
})
