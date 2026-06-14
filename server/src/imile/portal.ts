/**
 * iMile 各业务门户（DS/DC/OC/OPS）请求头拼装。
 * 新接口按 env 前缀 + defaults 声明即可，避免 resource-code / hubcode / path 配错。
 */

import {
  buildImileAuthHeaders,
  envFirst,
  envFirstOr,
  IMILE_DEFAULT_FRONT_SEC,
  IMILE_DEFAULT_HUBCODE,
  IMILE_DEFAULT_LANG,
  IMILE_DEFAULT_TIMEZONE,
} from './shared'

export type ImilePortalDefaults = {
  resourceCode: string
  sysName: string
  sysPortal: string
  origin: string
  referer: string
  hubcode?: string
  path?: string
}

export type ImilePortalOverrides = {
  hubcode?: string
  resourceCode?: string
  userCode?: string
  sysName?: string
  sysPortal?: string
  path?: string
}

export type BuildImilePortalHeadersInput = {
  token: string
  /** 环境变量前缀，如 IMILE_INBOUND → IMILE_INBOUND_RESOURCE_CODE */
  envPrefix: string
  defaults: ImilePortalDefaults
  /** 共享 lang/timezone/cookie/front-sec 时的回退前缀，如 ['IMILE_TRACK'] */
  sharedEnvPrefixes?: string[]
  /** 是否在 front-sec 中注入 userCode（IMILE_{PREFIX}_USER_CODE） */
  injectUserCode?: boolean
  /** 前端全局设置或调用方传入，优先级高于 env */
  overrides?: ImilePortalOverrides
  extra?: Record<string, string>
}

function pickOverride(value: string | undefined): string {
  return String(value ?? '').trim()
}

function resolvePortalField(override: string, envValue: string, fallback: string): string {
  if (override) return override
  return envValue || fallback
}

function envKey(prefix: string, suffix: string): string {
  return `${prefix}_${suffix}`
}

function readPortalEnv(prefix: string, suffix: string, fallbackPrefixes: string[], fallback: string): string {
  const keys = [envKey(prefix, suffix), ...fallbackPrefixes.map((p) => envKey(p, suffix))]
  return envFirstOr(keys, fallback)
}

function readPortalFrontSec(
  prefix: string,
  sharedPrefixes: string[],
  injectUserCode: boolean,
  overrideUserCode?: string,
): string {
  const directKeys = [envKey(prefix, 'FRONT_SEC'), ...sharedPrefixes.map((p) => envKey(p, 'FRONT_SEC'))]
  const fromEnv = envFirst(...directKeys)
  if (fromEnv) return fromEnv

  if (!injectUserCode) return IMILE_DEFAULT_FRONT_SEC

  const userCode = pickOverride(overrideUserCode) || envFirst(envKey(prefix, 'USER_CODE'))
  if (!userCode) return IMILE_DEFAULT_FRONT_SEC

  return JSON.stringify({
    orgId: 10,
    entId: 10,
    userCode,
    moduleId: 10007,
    client: 'pc',
  })
}

export function buildImilePortalHeaders(input: BuildImilePortalHeadersInput): Record<string, string> {
  const shared = input.sharedEnvPrefixes ?? []
  const defaults = input.defaults
  const overrides = input.overrides ?? {}

  const headers = buildImileAuthHeaders({
    token: input.token,
    resourceCode: resolvePortalField(
      pickOverride(overrides.resourceCode),
      readPortalEnv(input.envPrefix, 'RESOURCE_CODE', shared, defaults.resourceCode),
      defaults.resourceCode,
    ),
    sysName: resolvePortalField(
      pickOverride(overrides.sysName),
      readPortalEnv(input.envPrefix, 'SYS_NAME', shared, defaults.sysName),
      defaults.sysName,
    ),
    sysPortal: resolvePortalField(
      pickOverride(overrides.sysPortal),
      readPortalEnv(input.envPrefix, 'SYS_PORTAL', shared, defaults.sysPortal),
      defaults.sysPortal,
    ),
    origin: readPortalEnv(input.envPrefix, 'ORIGIN', shared, defaults.origin),
    referer: readPortalEnv(input.envPrefix, 'REFERER', shared, defaults.referer),
    frontSecEnvKeys: [],
    hubcodeEnvKeys: [],
    langEnvKeys: [envKey(input.envPrefix, 'LANG'), ...shared.map((p) => envKey(p, 'LANG'))],
    timezoneEnvKeys: [envKey(input.envPrefix, 'TIMEZONE'), ...shared.map((p) => envKey(p, 'TIMEZONE'))],
    cookieEnvKeys: [envKey(input.envPrefix, 'COOKIE'), ...shared.map((p) => envKey(p, 'COOKIE'))],
    extra: {
      'Content-Type': 'application/json',
      ...(defaults.path || overrides.path
        ? {
            path: resolvePortalField(
              pickOverride(overrides.path),
              readPortalEnv(input.envPrefix, 'PATH', shared, defaults.path ?? ''),
              defaults.path ?? '',
            ),
          }
        : {}),
      ...input.extra,
    },
  })

  headers['front-sec'] = readPortalFrontSec(
    input.envPrefix,
    shared,
    input.injectUserCode ?? false,
    overrides.userCode,
  )
  headers.hubcode = resolvePortalField(
    pickOverride(overrides.hubcode),
    readPortalEnv(input.envPrefix, 'HUBCODE', shared, defaults.hubcode ?? IMILE_DEFAULT_HUBCODE),
    defaults.hubcode ?? IMILE_DEFAULT_HUBCODE,
  )
  headers.lang = readPortalEnv(input.envPrefix, 'LANG', shared, IMILE_DEFAULT_LANG)
  headers.timezone = readPortalEnv(input.envPrefix, 'TIMEZONE', shared, IMILE_DEFAULT_TIMEZONE)

  return headers
}

/** dc.imile.com 扫描查询（ScanQuery）门户默认配置 */
export const IMILE_DC_SCAN_QUERY_PORTAL: ImilePortalDefaults = {
  resourceCode: 'ScanQuery',
  sysName: 'DS',
  sysPortal: 'DC',
  origin: 'https://dc.imile.com',
  referer: 'https://dc.imile.com/',
  hubcode: 'S210372901',
  path: '/DCoperation/DCScanmanagement/ScanQuery',
}

/** ds.imile.com 异常闭环门户默认配置 */
export const IMILE_DS_CLOSURE_PORTAL: ImilePortalDefaults = {
  resourceCode: 'orderExceptionClosure',
  sysName: 'DS',
  sysPortal: 'DS',
  origin: 'https://ds.imile.com',
  referer: 'https://ds.imile.com/',
}

/** ds.imile.com saastms 报表 / 运单查询门户默认配置 */
export const IMILE_DS_SAAS_TMS_PORTAL: ImilePortalDefaults = {
  resourceCode: 'cancelScanQuery',
  sysName: 'DS',
  sysPortal: 'DS',
  origin: 'https://ds.imile.com',
  referer: 'https://ds.imile.com/',
  hubcode: 'S210431701',
}

/** ds.imile.com 前台箱号分配列表（assignedList）门户默认配置 */
export const IMILE_DS_BOX_ASSIGNED_PORTAL: ImilePortalDefaults = {
  resourceCode: 'assignedList',
  sysName: 'DS',
  sysPortal: 'DS',
  origin: 'https://ds.imile.com',
  referer: 'https://ds.imile.com/',
  hubcode: 'S210431701',
  path: '/DSOperation/hubOperation/report/pd/box/assignedList',
}

/** oc.imile.com 阻断日志门户默认配置 */
export const IMILE_OC_INTERCEPT_PORTAL: ImilePortalDefaults = {
  resourceCode: 'listScanInterceptLogs',
  sysName: 'OC',
  sysPortal: 'OC',
  origin: 'https://oc.imile.com',
  referer: 'https://oc.imile.com/',
}
