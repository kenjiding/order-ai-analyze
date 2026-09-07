import type { TFunction } from 'i18next'
import { i18n } from '../../i18n'
import type { OrderAnalyzeResultItem } from './orderExceptionApi'
import { LOSS_SCOPE_OPTIONS, type ConcreteLossScope, type LossScope } from './types'

export const REGRESSION_LOSS_SCOPES: OrderAnalyzeResultItem['lossScope'][] = [
  '库内丢失',
  '库外丢失',
  '3PL丢件',
  '虚假转运',
  '暂无异常',
  '需人工判断',
]

export const SUB_TYPE_BY_SCOPE: Partial<Record<OrderAnalyzeResultItem['lossScope'], string[]>> = {
  库内丢失: ['扫描员丢失', '疑似派件员窃取'],
  库外丢失: ['快递员丢失'],
  暂无异常: ['已签收', '订单已完结', 'Abandon销毁', '暂存', '退返商家', ''],
}

const LOSS_SCOPE_I18N_KEY: Partial<Record<string, string>> = {
  库内丢失: 'lossScope.inHubLoss',
  库外丢失: 'lossScope.lastMileLoss',
  '3PL丢件': 'lossScope.thirdPartyLoss',
  虚假转运: 'lossScope.fakeTransfer',
  暂无异常: 'lossScope.noException',
  需人工判断: 'lossScope.manualReview',
  未知: 'lossScope.unknown',
}

const SUB_TYPE_I18N_KEY: Partial<Record<string, string>> = {
  扫描员丢失: 'subType.scannerLoss',
  疑似派件员窃取: 'subType.suspectedCourierTheft',
  快递员丢失: 'subType.courierLoss',
  已签收: 'subType.signed',
  订单已完结: 'subType.orderClosed',
  'Abandon销毁': 'subType.abandonDestroy',
  暂存: 'subType.storage',
  退返商家: 'subType.returnToMerchant',
}

export function lossScopeLabel(t: TFunction, value: string): string {
  const key = LOSS_SCOPE_I18N_KEY[value]
  return key ? t(key) : value
}

export function subTypeLabel(t: TFunction, value: string): string {
  if (!value) return t('regression.noSubType')
  const key = SUB_TYPE_I18N_KEY[value]
  return key ? t(key) : value
}

export function lossScopeOptions(t: TFunction, values: readonly string[]) {
  return values.map((value) => ({ label: lossScopeLabel(t, value), value }))
}

export function concreteLossScopeOptions(t: TFunction) {
  return lossScopeOptions(t, LOSS_SCOPE_OPTIONS)
}

export function regressionLossScopeOptions(t: TFunction) {
  return lossScopeOptions(t, REGRESSION_LOSS_SCOPES)
}

export function editLossScopeOptions(t: TFunction, draftLossScope: LossScope) {
  const values: LossScope[] = [...LOSS_SCOPE_OPTIONS]
  if (draftLossScope === '未知') values.push('未知')
  return lossScopeOptions(t, values)
}

export function subTypeOptionsForScope(t: TFunction, scope: OrderAnalyzeResultItem['lossScope']) {
  const list = SUB_TYPE_BY_SCOPE[scope]
  if (!list) return [{ label: t('regression.noSubType'), value: '' }]
  return list.map((value) => ({ label: subTypeLabel(t, value), value }))
}

export function isConcreteLossScope(value: string): value is ConcreteLossScope {
  return (LOSS_SCOPE_OPTIONS as readonly string[]).includes(value)
}

export function oeT(key: string, options?: Record<string, unknown>): string {
  return String(i18n.t(key, { ns: 'orderException', ...options }))
}
