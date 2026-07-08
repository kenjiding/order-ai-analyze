import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

export const regions = pgTable('regions', {
  code: varchar('code', { length: 16 }).primaryKey(),
  name: varchar('name', { length: 128 }).notNull(),
  nameEn: varchar('name_en', { length: 128 }),
  sortOrder: integer('sort_order').notNull().default(0),
})

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: varchar('username', { length: 64 }).notNull(),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    displayName: varchar('display_name', { length: 255 }),
    regionId: varchar('region_id', { length: 16 }).references(() => regions.code, { onDelete: 'restrict' }),
    role: varchar('role', { length: 32 }).notNull().default('user'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_username_unique').on(table.username)],
)

export const permissions = pgTable('permissions', {
  key: varchar('key', { length: 128 }).primaryKey(),
  type: varchar('type', { length: 16 }).notNull(),
  label: varchar('label', { length: 255 }).notNull(),
  description: varchar('description', { length: 512 }),
  menuKey: varchar('menu_key', { length: 64 }),
  sortOrder: integer('sort_order').notNull().default(0),
})

export const userPermissions = pgTable(
  'user_permissions',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    permissionKey: varchar('permission_key', { length: 128 })
      .notNull()
      .references(() => permissions.key, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.userId, table.permissionKey] })],
)

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: varchar('type', { length: 128 }).notNull(),
    regionCode: varchar('region_code', { length: 16 }),
    status: varchar('status', { length: 32 }).notNull().default('pending'),
    idempotencyKey: varchar('idempotency_key', { length: 255 }),
    payload: jsonb('payload').notNull().default({}),
    progress: jsonb('progress').notNull().default({}),
    error: varchar('error', { length: 2048 }),
    artifactPath: varchar('artifact_path', { length: 512 }),
    artifactExpiresAt: timestamp('artifact_expires_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    lockedBy: varchar('locked_by', { length: 128 }),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('jobs_idempotency_key_unique').on(table.idempotencyKey),
    index('jobs_status_created_at_idx').on(table.status, table.createdAt),
    index('jobs_region_created_at_idx').on(table.regionCode, table.createdAt),
  ],
)

export const efficiencyAttendanceDailyRecords = pgTable(
  'efficiency_attendance_daily_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recordDate: varchar('record_date', { length: 10 }).notNull(),
    regionCode: varchar('region_code', { length: 16 }).notNull().default('global'),
    payload: jsonb('payload').notNull(),
    savedBy: uuid('saved_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('efficiency_attendance_daily_records_date_region_unique').on(
      table.recordDate,
      table.regionCode,
    ),
    index('efficiency_attendance_daily_records_region_updated_idx').on(table.regionCode, table.updatedAt),
  ],
)

export const orderExceptionPostFilterConfigs = pgTable(
  'order_exception_post_filter_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    configKey: varchar('config_key', { length: 64 }).notNull(),
    payload: jsonb('payload').notNull(),
    savedBy: uuid('saved_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('order_exception_post_filter_configs_key_unique').on(table.configKey),
  ],
)

export const orderExceptionWarehouseConfigs = pgTable(
  'order_exception_warehouse_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    configKey: varchar('config_key', { length: 64 }).notNull(),
    payload: jsonb('payload').notNull(),
    savedBy: uuid('saved_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('order_exception_warehouse_configs_key_unique').on(table.configKey),
  ],
)

/** 飞书效率推送快照：每个 region 保留最新一次手动推送的 sort_efficiency_v1 快照，供定时调度复用。 */
export const feishuPushSnapshots = pgTable('feishu_push_snapshots', {
  regionCode: varchar('region_code', { length: 16 }).primaryKey(),
  periodLabel: varchar('period_label', { length: 255 }).notNull().default(''),
  snapshot: jsonb('snapshot').notNull(),
  pushedAt: timestamp('pushed_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * 统一供应商推送配置：车队推送 / 出仓告警 / 供应商数据分析共用。
 * 按 regionCode 隔离：同一个州的账号共用一份；历史数据未回填州归属，
 * 统一存为 'global'，不属于任何一个州，全部州可见且可编辑/删除；
 * 新建的配置固定落到创建者所属州（详见 fleetSupplierPushRouter.ts）。
 */
export const fleetSupplierPushConfigs = pgTable(
  'fleet_supplier_push_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vendorCode: varchar('vendor_code', { length: 64 }).notNull().default(''),
    vendorName: varchar('vendor_name', { length: 255 }).notNull().default(''),
    /** 推送展示用昵称，可与 iMile 供应商名称不同 */
    supplierNickname: varchar('supplier_nickname', { length: 255 }).notNull().default(''),
    routeCode: varchar('route_code', { length: 1024 }).notNull().default(''),
    webhookUrl: varchar('webhook_url', { length: 512 }).notNull().default(''),
    signingSecret: varchar('signing_secret', { length: 255 }),
    pushDescription: varchar('push_description', { length: 512 }),
    pushContent: text('push_content').notNull().default(''),
    regionCode: varchar('region_code', { length: 16 }).notNull().default('global'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('fleet_supplier_push_configs_region_idx').on(table.regionCode)],
)

/** 各业务独立的供应商 config 启用列表（与 catalog 解耦） */
export const supplierConfigScopeBindings = pgTable('supplier_config_scope_bindings', {
  scopeKey: varchar('scope_key', { length: 64 }).primaryKey(),
  enabledConfigIds: jsonb('enabled_config_ids').notNull().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** 通用用户偏好：按 (userId, prefKey) 一行，value 为业务自定义 jsonb（如供应商分析的指标勾选） */
export const userPreferences = pgTable(
  'user_preferences',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    prefKey: varchar('pref_key', { length: 128 }).notNull(),
    value: jsonb('value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.prefKey] })],
)

/** 供应商数据分析任务的完整分析结果，长期保存在数据库中，不受 jobs.artifactPath 文件 TTL 清理影响 */
export const vendorAnalysisSnapshots = pgTable(
  'vendor_analysis_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    regionCode: varchar('region_code', { length: 16 }),
    referenceDate: varchar('reference_date', { length: 10 }).notNull(),
    stationCodes: jsonb('station_codes').notNull().default([]),
    payload: jsonb('payload').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('vendor_analysis_snapshots_job_id_idx').on(table.jobId),
    index('vendor_analysis_snapshots_reference_date_idx').on(table.referenceDate, table.createdAt),
  ],
)

/** 供应商数据日报发布记录：每个任务（jobId）一行（同任务重复发布覆盖），供外部分享链接读取。保留一周（按 createdAt 清理） */
export const vendorDailyReports = pgTable(
  'vendor_daily_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 该日报对应的分析任务；删除任务级联删除其日报 */
    jobId: uuid('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
    /** 业务日期，仅供展示/排序，不再作为唯一键 */
    reportDate: varchar('report_date', { length: 10 }).notNull(),
    payload: jsonb('payload').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('vendor_daily_reports_job_id_unique').on(table.jobId),
    index('vendor_daily_reports_created_at_idx').on(table.createdAt),
  ],
)

/** 供应商数据日报分享链接：每个任务每个供应商一条，日报发布时自动开通，可禁用/重置；保留一周（按 createdAt 清理） */
export const vendorShareLinks = pgTable(
  'vendor_share_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 该链接对应的分析任务；删除任务级联删除其链接 */
    jobId: uuid('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
    vendorCode: varchar('vendor_code', { length: 64 }).notNull(),
    vendorName: varchar('vendor_name', { length: 255 }).notNull(),
    /** 业务日期，仅供展示，不再作为唯一键 */
    reportDate: varchar('report_date', { length: 10 }).notNull(),
    token: varchar('token', { length: 128 }).notNull(),
    isDisabled: boolean('is_disabled').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('vendor_share_links_vendor_job_unique').on(table.vendorCode, table.jobId),
    uniqueIndex('vendor_share_links_token_unique').on(table.token),
    index('vendor_share_links_job_id_idx').on(table.jobId),
  ],
)

/** 11点前出仓告警：定时推送配置（每个账号最多一条，userId 唯一） */
export const exitAlarmSchedules = pgTable(
  'exit_alarm_schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 拥有该配置的账号；时区按该账号的 regionCode 判断，未设置兜底阿德莱德 */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** 推送星期，1=周一…7=周日，存为 JSONB 数组 */
    weekdays: jsonb('weekdays').notNull().default([]),
    /** 推送时间点列表 [{id, time}]，time 格式 HH:mm（按拥有者账号所属州本地时间） */
    pushTimes: jsonb('push_times').notNull().default([]),
    isEnabled: boolean('is_enabled').notNull().default(true),
    /** 定时推送使用的站点编码（lastScanStationCode） */
    stationCode: varchar('station_code', { length: 64 }).notNull().default(''),
    /** 定时拉数使用的 iMile token（保存配置时从全局设置同步，不对外返回） */
    imileToken: varchar('imile_token', { length: 2048 }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('exit_alarm_schedules_user_id_unique').on(table.userId)],
)

/**
 * 定时任务幂等抢占记录：所有轮询式定时推送（出仓告警/催派推送/飞书日报等）共用。
 * 调用方确认"命中触发条件"之后、执行推送等副作用之前，用 (jobKey, slotKey) 抢占一次；
 * 插入成功才允许继续，插入失败（唯一约束冲突）说明这个时间槽已被别的 worker/重启窗口处理过，直接跳过。
 * jobKey 用于区分任务与归属实体，如 'exit-alarm:<scheduleId>'；slotKey 标识具体命中的时间槽，如 '2026-07-08|10:00'。
 */
export const scheduledJobClaims = pgTable(
  'scheduled_job_claims',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobKey: varchar('job_key', { length: 128 }).notNull(),
    slotKey: varchar('slot_key', { length: 64 }).notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('scheduled_job_claims_job_slot_unique').on(table.jobKey, table.slotKey)],
)

/** 催派推送：定时推送配置（每个账号最多一条，userId 唯一），复用出仓告警的供应商配置 catalog */
export const chaseDispatchSchedules = pgTable(
  'chase_dispatch_schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 拥有该配置的账号；时区按该账号的 regionCode 判断，未设置兜底阿德莱德 */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** 推送星期，1=周一…7=周日，存为 JSONB 数组 */
    weekdays: jsonb('weekdays').notNull().default([]),
    /** 推送时间点列表 [{id, time}]，time 格式 HH:mm（按拥有者账号所属州本地时间） */
    pushTimes: jsonb('push_times').notNull().default([]),
    /** 滞留时间区间多选，值如 '0-1' '1-2' … '7+'，存为 JSONB 字符串数组 */
    stagnationBuckets: jsonb('stagnation_buckets').notNull().default([]),
    isEnabled: boolean('is_enabled').notNull().default(true),
    /** 定时推送使用的站点编码（stockStationCodes） */
    stationCode: varchar('station_code', { length: 64 }).notNull().default(''),
    /** 定时拉数使用的 iMile token（保存配置时从全局设置同步，不对外返回） */
    imileToken: varchar('imile_token', { length: 2048 }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('chase_dispatch_schedules_user_id_unique').on(table.userId)],
)

/**
 * 站点日到件 waybillNo 索引（inbound/query 预取，供出仓告警、供应商分析等共享）。
 * 主键 (station_code, data_date)；单站单日约 1.5万–6万 条，jsonb 存字符串数组。
 */
export const stationInboundWaybillIndex = pgTable(
  'station_inbound_waybill_index',
  {
    stationCode: varchar('station_code', { length: 64 }).notNull(),
    /** 业务日期 YYYY-MM-DD（阿德莱德） */
    dataDate: varchar('data_date', { length: 10 }).notNull(),
    waybillNos: jsonb('waybill_nos').notNull().default([]),
    waybillCount: integer('waybill_count').notNull().default(0),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('station_inbound_waybill_index_station_date').on(table.stationCode, table.dataDate),
  ],
)

export type User = typeof users.$inferSelect
export type Region = typeof regions.$inferSelect
export type Permission = typeof permissions.$inferSelect
export type Job = typeof jobs.$inferSelect
export type NewJob = typeof jobs.$inferInsert
export type EfficiencyAttendanceDailyRecord = typeof efficiencyAttendanceDailyRecords.$inferSelect
export type NewEfficiencyAttendanceDailyRecord = typeof efficiencyAttendanceDailyRecords.$inferInsert
export type OrderExceptionPostFilterConfig = typeof orderExceptionPostFilterConfigs.$inferSelect
export type OrderExceptionWarehouseConfig = typeof orderExceptionWarehouseConfigs.$inferSelect
export type FeishuPushSnapshot = typeof feishuPushSnapshots.$inferSelect
export type VendorAnalysisSnapshot = typeof vendorAnalysisSnapshots.$inferSelect
export type NewVendorAnalysisSnapshot = typeof vendorAnalysisSnapshots.$inferInsert
export type VendorDailyReport = typeof vendorDailyReports.$inferSelect
export type NewVendorDailyReport = typeof vendorDailyReports.$inferInsert
export type VendorShareLink = typeof vendorShareLinks.$inferSelect
export type NewVendorShareLink = typeof vendorShareLinks.$inferInsert
export type FleetSupplierPushConfig = typeof fleetSupplierPushConfigs.$inferSelect
export type NewFleetSupplierPushConfig = typeof fleetSupplierPushConfigs.$inferInsert
export type ExitAlarmSchedule = typeof exitAlarmSchedules.$inferSelect
export type NewExitAlarmSchedule = typeof exitAlarmSchedules.$inferInsert
export type ScheduledJobClaim = typeof scheduledJobClaims.$inferSelect
export type NewScheduledJobClaim = typeof scheduledJobClaims.$inferInsert
export type ChaseDispatchSchedule = typeof chaseDispatchSchedules.$inferSelect
export type NewChaseDispatchSchedule = typeof chaseDispatchSchedules.$inferInsert
export type StationInboundWaybillIndex = typeof stationInboundWaybillIndex.$inferSelect
export type NewStationInboundWaybillIndex = typeof stationInboundWaybillIndex.$inferInsert
