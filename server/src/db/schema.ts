import {
  bigint,
  bigserial,
  boolean,
  doublePrecision,
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
    artifactPayload: jsonb('artifact_payload'),
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
    /** 路由码白名单（可选）；多码分隔格式与 routeCode 一致 */
    routeCodeWhitelist: varchar('route_code_whitelist', { length: 1024 }).notNull().default(''),
    /** 该供应商固定归属的站点编码（可选）；司机地图等按站点轮询的业务据此定位站点，不随单次报表变化 */
    stationCode: varchar('station_code', { length: 64 }).notNull().default(''),
    webhookUrl: varchar('webhook_url', { length: 512 }).notNull().default(''),
    signingSecret: varchar('signing_secret', { length: 255 }),
    /** 自建应用机器人所在群的 chat_id（选填）；配置后该供应商推送改走应用机器人消息接口，支持已读查询 */
    chatId: varchar('chat_id', { length: 64 }),
    pushDescription: varchar('push_description', { length: 512 }),
    pushContent: text('push_content').notNull().default(''),
    /** 群内需要 @ 的外部联系人花名册 [{name, openId}]；各推送是否实际 @ 由各自 schedule 的 mentionEnabled 决定 */
    mentionOpenIds: jsonb('mention_open_ids').notNull().default([]),
    regionCode: varchar('region_code', { length: 16 }).notNull().default('global'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('fleet_supplier_push_configs_region_idx').on(table.regionCode)],
)

/**
 * 通过自建应用机器人（im/v1/messages）发出的消息记录：仅记录走 chatId 通道的推送，
 * 用于后续调用 read_users 接口查询已读名单（飞书仅允许查发送后 7 天内的消息）。
 */
export const feishuPushMessages = pgTable(
  'feishu_push_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    supplierConfigId: uuid('supplier_config_id').references(() => fleetSupplierPushConfigs.id, { onDelete: 'cascade' }),
    chatId: varchar('chat_id', { length: 64 }).notNull(),
    messageId: varchar('message_id', { length: 64 }).notNull(),
    msgType: varchar('msg_type', { length: 32 }).notNull(),
    pushLabel: varchar('push_label', { length: 255 }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('feishu_push_messages_supplier_config_idx').on(table.supplierConfigId)],
)

/**
 * 飞书卡片按钮点击事件：卡片 2.0 button 同时挂 open_url + callback behavior，
 * 点击时飞书在跳转的同时把点击人 open_id 回传给我们（见 feishuEventRouter.ts）。
 * 用于「推送数据监控」页面统计谁点了 View Details / Resolve Tickets，不受飞书已读查询的 7 天限制（我们自己落库）。
 */
export const feishuCardClickEvents = pgTable(
  'feishu_card_click_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: varchar('message_id', { length: 64 }).notNull(),
    supplierConfigId: uuid('supplier_config_id').references(() => fleetSupplierPushConfigs.id, { onDelete: 'set null' }),
    openId: varchar('open_id', { length: 64 }).notNull(),
    /** 'view_details' | 'resolve_tickets' */
    actionType: varchar('action_type', { length: 32 }).notNull(),
    /** 'chase_dispatch' | 'dispatch_alarm' | 'work_order' */
    pushType: varchar('push_type', { length: 32 }).notNull(),
    clickedAt: timestamp('clicked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('feishu_card_click_events_message_idx').on(table.messageId),
    index('feishu_card_click_events_supplier_config_idx').on(table.supplierConfigId),
  ],
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

/** 供应商数据分析任务的完整分析结果，长期保存在数据库中，不受 jobs.artifactPayload 的 TTL 清理影响 */
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

/** 11点前出仓告警：定时推送配置（一个账号可有多条，按站点区分） */
export const exitAlarmSchedules = pgTable('exit_alarm_schedules', {
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
  /** 本条配置启用的供应商配置 id 列表，取代原来全局共享的 supplierConfigScopeBindings */
  pushConfigIds: jsonb('push_config_ids').notNull().default([]),
  /** 是否在推送时 @ 供应商配置里花名册的第 1 位外部联系人 */
  mentionEnabled: boolean('mention_enabled').notNull().default(false),
  /** 是否推送白名单路由码的 11 点前出仓数据（附加在同一张卡片里） */
  routeCodeWhitelistPushEnabled: boolean('route_code_whitelist_push_enabled').notNull().default(false),
  /** 定时拉数使用的 iMile token（保存配置时从全局设置同步，不对外返回） */
  imileToken: varchar('imile_token', { length: 2048 }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

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

/** 催派推送：定时推送配置（一个账号可有多条，按站点区分），复用出仓告警的供应商配置 catalog */
export const chaseDispatchSchedules = pgTable('chase_dispatch_schedules', {
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
  /** 本条配置启用的供应商配置 id 列表，取代原来全局共享的 supplierConfigScopeBindings */
  pushConfigIds: jsonb('push_config_ids').notNull().default([]),
  /** 是否在推送时 @ 供应商配置里花名册的第 1 位外部联系人 */
  mentionEnabled: boolean('mention_enabled').notNull().default(false),
  /** 定时拉数使用的 iMile token（保存配置时从全局设置同步，不对外返回） */
  imileToken: varchar('imile_token', { length: 2048 }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** 工单推送：定时推送配置（一个账号可有多条），复用出仓告警/催派推送的供应商配置 catalog */
export const workOrderPushSchedules = pgTable('work_order_push_schedules', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** 拥有该配置的账号；时区按该账号的 regionCode 判断，未设置兜底阿德莱德 */
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  /** 推送星期，1=周一…7=周日，存为 JSONB 数组 */
  weekdays: jsonb('weekdays').notNull().default([]),
  /** 每天检查的推送时间点列表 [{id, time}]，time 格式 HH:mm（按拥有者账号所属州本地时间） */
  pushTimes: jsonb('push_times').notNull().default([]),
  isEnabled: boolean('is_enabled').notNull().default(true),
  /** 定时查询使用的处理站点编码（handlerStationCode），只检查该站点的未处理工单 */
  stationCode: varchar('station_code', { length: 64 }).notNull().default(''),
  /** 本条配置启用的供应商配置 id 列表，取代原来全局共享的 supplierConfigScopeBindings */
  pushConfigIds: jsonb('push_config_ids').notNull().default([]),
  /** 是否在推送时 @ 供应商配置里花名册的第 1 位外部联系人 */
  mentionEnabled: boolean('mention_enabled').notNull().default(false),
  /** 定时拉数使用的 iMile token（保存配置时从全局设置同步，不对外返回） */
  imileToken: varchar('imile_token', { length: 2048 }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * 24小时派签告警：定时推送配置（一个账号可有多条，按站点区分）。
 * 从「供应商数据分析」的 24H 派签率指标封装复用出来的独立告警，配置形状与出仓告警一致。
 */
export const dispatchAlarmSchedules = pgTable('dispatch_alarm_schedules', {
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
  /** 24H 派签率预警阈值（百分比整数）：低于该值的供应商在卡片中标红并列出未达标运单号 */
  alertThresholdPct: integer('alert_threshold_pct').notNull().default(92),
  /** 本条配置启用的供应商配置 id 列表，取代原来全局共享的 supplierConfigScopeBindings */
  pushConfigIds: jsonb('push_config_ids').notNull().default([]),
  /** 是否在推送时 @ 供应商配置里花名册的第 1 位外部联系人 */
  mentionEnabled: boolean('mention_enabled').notNull().default(false),
  /** 是否在 24H 派签落地页展示「司机地图」组件 */
  showDriverMap: boolean('show_driver_map').notNull().default(false),
  /** 「立刻推送」使用的到件扫描日期 YYYY-MM-DD；为空时按自动计算的最近工作日兜底，不影响自动定时推送 */
  arrivalScanDate: varchar('arrival_scan_date', { length: 10 }),
  /** 定时拉数使用的 iMile token（保存配置时从全局设置同步，不对外返回） */
  imileToken: varchar('imile_token', { length: 2048 }),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

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

/** 出勤工作时间记录：人员名单（按 regionCode 隔离，同州内姓名唯一；zktEmpCode 预留给后续 ZKT 考勤 API 关联匹配） */
export const attendanceWorkers = pgTable(
  'attendance_workers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    regionCode: varchar('region_code', { length: 16 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    zktEmpCode: varchar('zkt_emp_code', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('attendance_workers_region_name_unique').on(table.regionCode, table.name),
    index('attendance_workers_region_idx').on(table.regionCode),
  ],
)

/** 出勤工作时间记录：单人单次工序/岗位工作时长（工序 processCategory + 班次 shift 对应表单的级联选择） */
export const attendanceWorkRecords = pgTable(
  'attendance_work_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    regionCode: varchar('region_code', { length: 16 }).notNull(),
    workerId: uuid('worker_id').notNull().references(() => attendanceWorkers.id, { onDelete: 'restrict' }),
    processCategory: varchar('process_category', { length: 32 }).notNull(),
    shift: varchar('shift', { length: 16 }).notNull(),
    zoneCode: varchar('zone_code', { length: 64 }),
    startTime: timestamp('start_time', { withTimezone: true }).notNull(),
    endTime: timestamp('end_time', { withTimezone: true }),
    notes: text('notes'),
    /** 记录来源：manual 手工录入 | zkt_sync 预留给后续 ZKT 考勤 API 同步 */
    source: varchar('source', { length: 16 }).notNull().default('manual'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('attendance_work_records_region_start_idx').on(table.regionCode, table.startTime),
    index('attendance_work_records_worker_idx').on(table.workerId),
  ],
)

/**
 * 站点日运单明细缓存：供「24H 派签增量拉取」与「司机地图」共用。
 * status: pending（尚无签收/问题件）| completed（有签收）| problem（仅有问题件）。
 * 终态判定见 isDispatch24hTerminal，不另存字段。
 */
export const driverMapWaybillPoints = pgTable(
  'driver_map_waybill_points',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    waybillNo: varchar('waybill_no', { length: 64 }).notNull(),
    stationCode: varchar('station_code', { length: 64 }).notNull(),
    vendorCode: varchar('vendor_code', { length: 64 }).notNull().default(''),
    courierCode: varchar('courier_code', { length: 64 }).notNull().default(''),
    courierName: varchar('courier_name', { length: 255 }).notNull().default(''),
    dataDate: varchar('data_date', { length: 10 }).notNull(),
    deliveryTime: varchar('delivery_time', { length: 32 }),
    signDate: varchar('sign_date', { length: 32 }),
    lastProblemDate: varchar('last_problem_date', { length: 32 }),
    /** searchWaybill.problemReason：问题件原因文案 */
    problemReason: varchar('problem_reason', { length: 512 }).notNull().default(''),
    consigneeRouteCode: varchar('consignee_route_code', { length: 64 }).notNull().default(''),
    lastScanSiteCode: varchar('last_scan_site_code', { length: 64 }).notNull().default(''),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    addressText: varchar('address_text', { length: 1024 }).notNull().default(''),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    geocodedAt: timestamp('geocoded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('driver_map_waybill_points_waybill_date_unique').on(table.waybillNo, table.dataDate),
    index('driver_map_waybill_points_station_date_idx').on(table.stationCode, table.dataDate),
    index('driver_map_waybill_points_status_idx').on(table.dataDate, table.status),
    index('driver_map_waybill_points_courier_idx').on(table.dataDate, table.courierCode),
  ],
)

/**
 * 催派推送外部分享快照：推送时落库，群内链接凭高熵 token 无登录查看运单明细。
 * 保留 3 天（按 createdAt 判定过期并清理）；payload 为白名单结构，不含 webhook/token。
 */
export const chaseDispatchShareSnapshots = pgTable(
  'chase_dispatch_share_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    token: varchar('token', { length: 128 }).notNull(),
    vendorCode: varchar('vendor_code', { length: 64 }).notNull(),
    vendorName: varchar('vendor_name', { length: 255 }).notNull(),
    baseDate: varchar('base_date', { length: 10 }).notNull(),
    pushTime: varchar('push_time', { length: 8 }).notNull(),
    /** 催派门户页展示用完整明细（区间 / 司机 / 运单号） */
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('chase_dispatch_share_snapshots_token_unique').on(table.token),
    index('chase_dispatch_share_snapshots_created_at_idx').on(table.createdAt),
  ],
)

/**
 * 24小时派签告警外部分享快照：推送时落库，群内链接凭高熵 token 无登录查看未达标运单明细。
 * 保留 3 天（按 createdAt 判定过期并清理）；payload 为白名单结构，不含 webhook/token。
 */
export const dispatchAlarmShareSnapshots = pgTable(
  'dispatch_alarm_share_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    token: varchar('token', { length: 128 }).notNull(),
    vendorCode: varchar('vendor_code', { length: 64 }).notNull(),
    vendorName: varchar('vendor_name', { length: 255 }).notNull(),
    stationCode: varchar('station_code', { length: 64 }).notNull(),
    date: varchar('date', { length: 10 }).notNull(),
    pushTime: varchar('push_time', { length: 8 }).notNull(),
    /** 派签告警门户页展示用完整明细（司机 / 未达标运单号） */
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('dispatch_alarm_share_snapshots_token_unique').on(table.token),
    index('dispatch_alarm_share_snapshots_created_at_idx').on(table.createdAt),
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
export type FeishuPushMessage = typeof feishuPushMessages.$inferSelect
export type NewFeishuPushMessage = typeof feishuPushMessages.$inferInsert
export type FeishuCardClickEvent = typeof feishuCardClickEvents.$inferSelect
export type NewFeishuCardClickEvent = typeof feishuCardClickEvents.$inferInsert
export type ExitAlarmSchedule = typeof exitAlarmSchedules.$inferSelect
export type NewExitAlarmSchedule = typeof exitAlarmSchedules.$inferInsert
export type ScheduledJobClaim = typeof scheduledJobClaims.$inferSelect
export type NewScheduledJobClaim = typeof scheduledJobClaims.$inferInsert
export type ChaseDispatchSchedule = typeof chaseDispatchSchedules.$inferSelect
export type NewChaseDispatchSchedule = typeof chaseDispatchSchedules.$inferInsert
export type StationInboundWaybillIndex = typeof stationInboundWaybillIndex.$inferSelect
export type NewStationInboundWaybillIndex = typeof stationInboundWaybillIndex.$inferInsert
export type WorkOrderPushSchedule = typeof workOrderPushSchedules.$inferSelect
export type NewWorkOrderPushSchedule = typeof workOrderPushSchedules.$inferInsert
export type DispatchAlarmSchedule = typeof dispatchAlarmSchedules.$inferSelect
export type NewDispatchAlarmSchedule = typeof dispatchAlarmSchedules.$inferInsert
export type AttendanceWorker = typeof attendanceWorkers.$inferSelect
export type NewAttendanceWorker = typeof attendanceWorkers.$inferInsert
export type AttendanceWorkRecord = typeof attendanceWorkRecords.$inferSelect
export type NewAttendanceWorkRecord = typeof attendanceWorkRecords.$inferInsert
export type DriverMapWaybillPoint = typeof driverMapWaybillPoints.$inferSelect
export type NewDriverMapWaybillPoint = typeof driverMapWaybillPoints.$inferInsert
export type ChaseDispatchShareSnapshot = typeof chaseDispatchShareSnapshots.$inferSelect
export type NewChaseDispatchShareSnapshot = typeof chaseDispatchShareSnapshots.$inferInsert

/** 容器管理：主体账户（RTI 责任主体目录，借出/归还/调拨均基于账户关系记账） */
export const containerAccounts = pgTable(
  'container_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 200 }).notNull(),
    /** BROKER 清关行 | CUSTOMER 客户 | INTERNAL_WAREHOUSE 内部仓库 */
    kind: varchar('kind', { length: 32 }).notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('container_accounts_kind_idx').on(table.kind)],
)

/** 容器管理：用户与主体账户的绑定关系，决定该用户可见与可操作的数据范围 */
export const containerAccountUsers = pgTable(
  'container_account_users',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => containerAccounts.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.accountId] }),
    index('container_account_users_account_idx').on(table.accountId),
  ],
)

/** 容器管理：容器台账（主体 × 品类 的库存余额基线） */
export const containerBalances = pgTable(
  'container_balances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => containerAccounts.id, { onDelete: 'restrict' }),
    /** BIG_BASKET 大篮筐 | SILVER_BOX 银框 */
    containerType: varchar('container_type', { length: 32 }).notNull(),
    quantity: integer('quantity').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('container_balances_account_type_unique').on(table.accountId, table.containerType),
  ],
)

/** 容器管理：流转记录主表。数量不落在这里，全部收敛到 container_transfer_items */
export const containerTransfers = pgTable(
  'container_transfers',
  {
    /** 自增主键；对外展示为 TR-000123，格式化只在展示层做 */
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    /** LEND 借出 | RETURN 归还 | INTERNAL_TRANSFER 仓间调拨 | IN_TRANSIT_OUT 在途发出 | IN_TRANSIT_IN 在途签收 */
    kind: varchar('kind', { length: 32 }).notNull(),
    /** PENDING_RECEIVER 待接收方确认 | DISPUTED 协商中 | CONFIRMED 已确认 | CANCELLED 已取消 */
    status: varchar('status', { length: 32 }).notNull(),
    fromAccountId: uuid('from_account_id')
      .notNull()
      .references(() => containerAccounts.id, { onDelete: 'restrict' }),
    toAccountId: uuid('to_account_id')
      .notNull()
      .references(() => containerAccounts.id, { onDelete: 'restrict' }),
    imageUrl: text('image_url'),
    note: text('note'),
    /** 接收方差异申报 */
    receiverReportReason: text('receiver_report_reason'),
    receiverReportImageUrl: text('receiver_report_image_url'),
    /** 无争议确认时的补充说明 */
    responseNote: text('response_note'),
    senderAcceptedAt: timestamp('sender_accepted_at', { withTimezone: true }),
    senderAcceptedBy: uuid('sender_accepted_by').references(() => users.id, { onDelete: 'set null' }),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    respondedBy: uuid('responded_by').references(() => users.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('container_transfers_created_at_idx').on(table.createdAt),
    index('container_transfers_from_account_idx').on(table.fromAccountId),
    index('container_transfers_to_account_idx').on(table.toAccountId),
    index('container_transfers_status_idx').on(table.status),
  ],
)

/** 容器管理：流转明细，逐品类记录「申报 / 实收 / 落表」三个数量，是数量的唯一真相源 */
export const containerTransferItems = pgTable(
  'container_transfer_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transferId: bigint('transfer_id', { mode: 'number' })
      .notNull()
      .references(() => containerTransfers.id, { onDelete: 'cascade' }),
    containerType: varchar('container_type', { length: 32 }).notNull(),
    /** 转出方申报数量 */
    declaredQuantity: integer('declared_quantity').notNull(),
    /** 接收方差异申报的实收数量；未申报时为 null */
    receivedQuantity: integer('received_quantity'),
    /** 最终记账落表数量；未落表时为 null */
    settledQuantity: integer('settled_quantity'),
  },
  (table) => [
    uniqueIndex('container_transfer_items_transfer_type_unique').on(table.transferId, table.containerType),
    index('container_transfer_items_transfer_idx').on(table.transferId),
  ],
)

/** 容器管理：台账变更审计。手工增删改与流转记账都会写入，流转来源带 transferId */
export const containerBalanceAudits = pgTable(
  'container_balance_audits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** CREATE | UPDATE | DELETE | TRANSFER */
    action: varchar('action', { length: 16 }).notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => containerAccounts.id, { onDelete: 'restrict' }),
    containerType: varchar('container_type', { length: 32 }).notNull(),
    prevQuantity: integer('prev_quantity'),
    newQuantity: integer('new_quantity'),
    delta: integer('delta'),
    /** INITIAL_STOCKTAKE | STOCKTAKE_CORRECTION | DAMAGE_SCRAP | LOSS_REPORT | HISTORICAL_BACKFILL | TRANSFER_SETTLEMENT */
    reasonType: varchar('reason_type', { length: 32 }).notNull(),
    reason: text('reason').notNull().default(''),
    transferId: bigint('transfer_id', { mode: 'number' }).references(() => containerTransfers.id, {
      onDelete: 'set null',
    }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorIp: varchar('actor_ip', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('container_balance_audits_account_created_idx').on(table.accountId, table.createdAt),
    index('container_balance_audits_created_at_idx').on(table.createdAt),
    index('container_balance_audits_transfer_idx').on(table.transferId),
  ],
)

/** 容器管理：流转协商留言 */
export const containerTransferMessages = pgTable(
  'container_transfer_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transferId: bigint('transfer_id', { mode: 'number' })
      .notNull()
      .references(() => containerTransfers.id, { onDelete: 'cascade' }),
    authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    proposedQuantity: integer('proposed_quantity'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('container_transfer_messages_transfer_idx').on(table.transferId, table.createdAt)],
)

/** 容器管理：流转记录编辑/删除审计，记录删除后 transferId 置空但保留快照 */
export const containerTransferChanges = pgTable(
  'container_transfer_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transferId: bigint('transfer_id', { mode: 'number' }).references(() => containerTransfers.id, {
      onDelete: 'set null',
    }),
    /** UPDATE | DELETE */
    action: varchar('action', { length: 16 }).notNull(),
    reason: text('reason').notNull().default(''),
    beforeData: jsonb('before_data').notNull(),
    afterData: jsonb('after_data'),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('container_transfer_changes_transfer_idx').on(table.transferId),
    index('container_transfer_changes_created_at_idx').on(table.createdAt),
  ],
)

export type ContainerAccount = typeof containerAccounts.$inferSelect
export type NewContainerAccount = typeof containerAccounts.$inferInsert
export type ContainerAccountUser = typeof containerAccountUsers.$inferSelect
export type ContainerBalance = typeof containerBalances.$inferSelect
export type NewContainerBalance = typeof containerBalances.$inferInsert
export type ContainerBalanceAudit = typeof containerBalanceAudits.$inferSelect
export type NewContainerBalanceAudit = typeof containerBalanceAudits.$inferInsert
export type ContainerTransfer = typeof containerTransfers.$inferSelect
export type NewContainerTransfer = typeof containerTransfers.$inferInsert
export type ContainerTransferItem = typeof containerTransferItems.$inferSelect
export type NewContainerTransferItem = typeof containerTransferItems.$inferInsert
export type ContainerTransferMessage = typeof containerTransferMessages.$inferSelect
export type NewContainerTransferMessage = typeof containerTransferMessages.$inferInsert
export type ContainerTransferChange = typeof containerTransferChanges.$inferSelect
export type NewContainerTransferChange = typeof containerTransferChanges.$inferInsert
