/**
 * iMile 各业务门户（DS/DC/OC/OPS）请求头拼装。
 * 新接口按 env 前缀 + defaults 声明即可，避免 resource-code / hubcode / path 配错。
 */

import {
  buildImileAuthHeaders,
  envFirst,
  envFirstOr,
  getRequestImileHubcode,
  applyImileCountryToCookie,
  IMILE_DEFAULT_FRONT_SEC,
  IMILE_DEFAULT_HUBCODE,
  IMILE_DEFAULT_LANG,
  resolveImileCountry,
  resolveImileTimezone,
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
    getRequestImileHubcode() ||
      readPortalEnv(input.envPrefix, 'HUBCODE', shared, defaults.hubcode ?? IMILE_DEFAULT_HUBCODE),
    defaults.hubcode ?? IMILE_DEFAULT_HUBCODE,
  )
  headers.lang = readPortalEnv(input.envPrefix, 'LANG', shared, IMILE_DEFAULT_LANG)

  // 与正式站一致：国家选择器驱动 timezone + Cookie TIMEZONE / TIMEZONE_COUNTRY
  const country = resolveImileCountry()
  headers.timezone = resolveImileTimezone(country)
  headers.Cookie = applyImileCountryToCookie(headers.Cookie, country)

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

/**
 * dc.imile.com 退返商家（RTC）门户默认配置。
 * resource-code / path 未经抓包确认，如鉴权失败可用 IMILE_RTC_RESOURCE_CODE / IMILE_RTC_PATH 勘误。
 */
export const IMILE_DC_RTC_PORTAL: ImilePortalDefaults = {
  resourceCode: 'RTC',
  sysName: 'DS',
  sysPortal: 'DC',
  origin: 'https://dc.imile.com',
  referer: 'https://dc.imile.com/',
  path: '/DCoperation/DCScanmanagement/RTC',
}

/** ds.imile.com 异常闭环门户默认配置 */
export const IMILE_DS_CLOSURE_PORTAL: ImilePortalDefaults = {
  resourceCode: 'orderExceptionClosure',
  sysName: 'DS',
  sysPortal: 'DS',
  origin: 'https://ds.imile.com',
  referer: 'https://ds.imile.com/',
}

/**
 * 责任站点列表（permission/station）：正式站从 DAInventory 页发起时的门户头。
 * 切国家时还需同步 timezone / Cookie TIMEZONE_COUNTRY（由 buildImilePortalHeaders 统一注入）。
 */
export const IMILE_STATION_LIST_PORTAL: ImilePortalDefaults = {
  resourceCode: 'DAInventory',
  sysName: 'IMILE',
  sysPortal: 'DS',
  origin: 'https://ds.imile.com',
  referer: 'https://ds.imile.com/',
  path: '/DSMonitor/DSInventory/DAInventory',
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

/**
 * ds.imile.com 工单查询（ticketQuery）门户默认配置（催派"≥7 天"过滤已有工单运单用）。
 * resourceCode 为占位值，若实际请求鉴权失败需通过 IMILE_CHASE_DISPATCH_TICKET_RESOURCE_CODE 勘误。
 */
export const IMILE_DS_TICKET_PORTAL: ImilePortalDefaults = {
  resourceCode: 'ticketQuery',
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

/**
 * oc.imile.com 分拣坐标查询（cornerstone/sorting/pageList）门户默认配置。
 * resourceCode 为占位值，若实际请求鉴权失败需通过 IMILE_SORTING_RESOURCE_CODE 勘误。
 */
export const IMILE_OC_SORTING_PORTAL: ImilePortalDefaults = {
  resourceCode: 'sortingPageList',
  sysName: 'OC',
  sysPortal: 'OC',
  origin: 'https://oc.imile.com',
  referer: 'https://oc.imile.com/',
}

/**
 * globalcs.imile.com 客诉工单门户默认配置（placeholder）。
 * resourceCode / sysName / sysPortal 须通过环境变量覆盖：
 *   IMILE_GLOBALCS_RESOURCE_CODE, IMILE_GLOBALCS_SYS_NAME, IMILE_GLOBALCS_SYS_PORTAL
 *   IMILE_GLOBALCS_COOKIE（若需要 Cookie 认证）
 */
export const IMILE_GLOBALCS_PORTAL: ImilePortalDefaults = {
  resourceCode: 'ticketQuery',
  sysName: 'CS',
  sysPortal: 'CS',
  origin: 'https://globalcs.imile.com',
  referer: 'https://globalcs.imile.com/',
}
