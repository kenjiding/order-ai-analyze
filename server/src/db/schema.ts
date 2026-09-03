import {
  bigint,
  bigserial,
  boolean,
  date,
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
    /**
     * 供应商单位键（vendorCode::展示名）：链接按「一家供应商」开通，不是按编码。
     * ADL-City 和 ADL-Lu 共用编码，按编码建链接会让两家共用一个 token、看到对方的数据。
     */
    supplierKey: varchar('supplier_key', { length: 320 }).notNull(),
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
    uniqueIndex('vendor_share_links_unit_job_unique').on(table.supplierKey, table.jobId),
    uniqueIndex('vendor_share_links_token_unique').on(table.token),
    index('vendor_share_links_job_id_idx').on(table.jobId),
  ],
)

/** 滞留数据告警：定时推送配置（一个账号可有多条，按站点区分） */
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
  /** 「立刻推送」使用的到件扫描日期 YYYY-MM-DD；为空时按自动计算的最近工作日兜底，不影响自动定时推送 */
  arrivalScanDate: varchar('arrival_scan_date', { length: 10 }),
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

/** 容器管理：站点账户（RTI 责任站点目录，借出/归还/调拨均基于账户关系记账） */
export const containerAccounts = pgTable(
  'container_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 200 }).notNull(),
    /** BROKER 清关行 | CUSTOMER 客户 | INTERNAL_WAREHOUSE 内部仓库 */
    kind: varchar('kind', { length: 32 }).notNull(),
    /**
     * 该账户方在本系统没有登录账号（清关行、客户多属此类）。
     * 与 kind 解耦：清关行将来开了账号只需关掉开关，不改代码。
     * 置 true 后，它作为接收方的流转由转出方凭线下回单代确认，作为转出方的流转可由内部人员代录。
     */
    isExternal: boolean('is_external').notNull().default(false),
    /** 流转变更时的飞书通知配置 { enabled, chatId, mentions }：选群仅用于拉成员名单，实际按 openId 私聊 */
    pushNotify: jsonb('push_notify').notNull().default({ enabled: false, chatId: '', mentions: [] }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('container_accounts_kind_idx').on(table.kind)],
)

/** 容器管理：用户与站点账户的绑定关系，决定该用户可见与可操作的数据范围 */
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

/** 容器管理：容器台账（站点 × 品类 的库存余额基线） */
export const containerBalances = pgTable(
  'container_balances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => containerAccounts.id, { onDelete: 'restrict' }),
    /** BIG_BASKET 大蓝筐 | SILVER_BOX 银筐 */
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
    /** 业务发生日期（精确到日）：补录历史流转时与录入时间 createdAt 不同 */
    occurredAt: date('occurred_at').notNull().defaultNow(),
    note: text('note'),
    /** 接收方差异申报 */
    receiverReportReason: text('receiver_report_reason'),
    receiverReportImageUrl: text('receiver_report_image_url'),
    /** 无争议确认时的补充说明 */
    responseNote: text('response_note'),
    /** 接收方无系统账号，本单由转出方凭线下回单代为确认；操作人与时间仍记在 respondedBy/respondedAt */
    proxyConfirmed: boolean('proxy_confirmed').notNull().default(false),
    /** 代确认依据：回单、签收单或聊天截图。选填，缺失时台账争议只能靠 responseNote 追溯 */
    proxyEvidenceUrl: text('proxy_evidence_url'),
    senderAcceptedAt: timestamp('sender_accepted_at', { withTimezone: true }),
    senderAcceptedBy: uuid('sender_accepted_by').references(() => users.id, { onDelete: 'set null' }),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    respondedBy: uuid('responded_by').references(() => users.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('container_transfers_created_at_idx').on(table.createdAt),
    index('container_transfers_occurred_at_idx').on(table.occurredAt),
    index('container_transfers_from_account_idx').on(table.fromAccountId),
    index('container_transfers_to_account_idx').on(table.toAccountId),
    index('container_transfers_status_idx').on(table.status),
  ],
)

/** 容器管理：流转明细，逐品类记录「转出方发出 / 接收方实收 / 已入账」三个数量，是数量的唯一真相源 */
export const containerTransferItems = pgTable(
  'container_transfer_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transferId: bigint('transfer_id', { mode: 'number' })
      .notNull()
      .references(() => containerTransfers.id, { onDelete: 'cascade' }),
    containerType: varchar('container_type', { length: 32 }).notNull(),
    /** 转出方发出数量 */
    declaredQuantity: integer('declared_quantity').notNull(),
    /** 接收方差异申报的实收数量；未申报时为 null */
    receivedQuantity: integer('received_quantity'),
    /** 最终入账数量；未入账时为 null */
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
export type ContainerTransferChange = typeof containerTransferChanges.$inferSelect
export type NewContainerTransferChange = typeof containerTransferChanges.$inferInsert

/**
 * 出仓派签达成分析的日度指标表：以「到件日 D」为批次，在两个指标都定终值后一次性结算落库。
 *
 * 只存最细粒度格子（供应商单位 × 路由码 × 司机），路由码层与供应商层查询时 SUM 得到——
 * 同一份数据不存三份，也就没有三份之间的一致性问题。
 * 四象限 exit_*_sign_* 之和恒等于 total，两个指标的分子分母全部由它导出：
 *   24H 派签达标 = exit_met_sign_met + exit_unmet_sign_met
 *   11点前出仓达标 = exit_met_sign_met + exit_met_sign_unmet
 * courier_code / route_code 用空串表示「未派件（无司机）」「无路由码」，保证司机行加总 = 供应商总数。
 */
export const dispatchPerformanceDailyStats = pgTable(
  'dispatch_performance_daily_stats',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 到件日 D（YYYY-MM-DD，账号州时区的本地日历日） */
    arrivalDate: varchar('arrival_date', { length: 10 }).notNull(),
    stationCode: varchar('station_code', { length: 64 }).notNull(),
    /** 统计主键：buildSupplierUnitKey 生成的 vendorCode::展示名，不是裸 vendorCode */
    supplierKey: varchar('supplier_key', { length: 512 }).notNull(),
    vendorCode: varchar('vendor_code', { length: 64 }).notNull().default(''),
    supplierName: varchar('supplier_name', { length: 255 }).notNull().default(''),
    routeCode: varchar('route_code', { length: 128 }).notNull().default(''),
    courierCode: varchar('courier_code', { length: 64 }).notNull().default(''),
    courierName: varchar('courier_name', { length: 255 }).notNull().default(''),
    /**
     * 该格子的路由码命中了供应商配置的路由码白名单。
     *
     * 白名单路由「不参与考核」但要看得见：路由码/司机两层照常展示各自指标，
     * 供应商行与站点汇总在累加时跳过这些格子（见 queryDispatchPerformance）。
     */
    isWhitelist: boolean('is_whitelist').notNull().default(false),

    total: integer('total').notNull().default(0),
    /**
     * 11点前出仓达标数。单独存而不是从四象限反推：出仓那一趟（D+1）就已定终值，
     * 此时派签还没结算、四象限填不出来，反推不了。
     * 派签结算后应恒等于 exitMetSignMet + exitMetSignUnmet。
     */
    before11Met: integer('before11_met').notNull().default(0),
    /** 派签是否已结算（D+2 那一趟）。false 时以下四象限全为 0，派签率必须显示为「结算中」而非 0% */
    dispatchSettled: boolean('dispatch_settled').notNull().default(false),
    exitMetSignMet: integer('exit_met_sign_met').notNull().default(0),
    exitMetSignUnmet: integer('exit_met_sign_unmet').notNull().default(0),
    exitUnmetSignMet: integer('exit_unmet_sign_met').notNull().default(0),
    exitUnmetSignUnmet: integer('exit_unmet_sign_unmet').notNull().default(0),

    problemCount: integer('problem_count').notNull().default(0),
    neverSignedCount: integer('never_signed_count').notNull().default(0),
    lateSignedCount: integer('late_signed_count').notNull().default(0),

    neverSignedWaybillNos: jsonb('never_signed_waybill_nos').notNull().default([]),
    lateSignedWaybillNos: jsonb('late_signed_waybill_nos').notNull().default([]),
    problemWaybillNos: jsonb('problem_waybill_nos').notNull().default([]),
    before11UnmetWaybillNos: jsonb('before11_unmet_waybill_nos').notNull().default([]),

    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('dispatch_performance_daily_stats_cell_unique').on(
      table.arrivalDate,
      table.stationCode,
      table.supplierKey,
      table.routeCode,
      table.courierCode,
    ),
    index('dispatch_performance_daily_stats_station_date_idx').on(table.arrivalDate, table.stationCode),
    index('dispatch_performance_daily_stats_supplier_idx').on(table.supplierKey, table.arrivalDate),
  ],
)

/**
 * 出仓派签达成分析的站点配置：一个站点一条，确认后即开启该站点的每日两趟结算。
 *
 * 按站点全局唯一而非每账号一份——结算是系统级任务、产出共享数据，
 * 两个账号都配同一站点会重复结算、重复打 iMile。regionCode / createdBy 只用于
 * 列表可见性与审计，不参与调度。
 *
 * 统计范围就在这里配：pushConfigIds 显式勾选 fleetSupplierPushConfigs 的行，与四个告警同一套。
 * 早期版本靠 stationCode 反查该站点下的供应商，已被证伪——那张表的 station_code 大量为空
 * （老的全局配置）或绑在别的站点上，反查会把整站供应商漏光，聚合出 0 个格子却照样标记「已结算」。
 * 代价是漏勾的供应商历史数据会永久缺失（结算不回补），安全网见 settleOneArrivalDate。
 */
export const dispatchPerformanceConfigs = pgTable(
  'dispatch_performance_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stationCode: varchar('station_code', { length: 64 }).notNull(),
    /** 保存那一刻的站点展示名，避免列表页为了显示名字再去查 iMile */
    stationName: varchar('station_name', { length: 255 }).notNull().default(''),
    regionCode: varchar('region_code', { length: 32 }).notNull().default(''),
    /**
     * 纳入统计的供应商 = fleet_supplier_push_configs 的行 id 列表，与四个告警的 pushConfigIds 同一套。
     *
     * 不靠 stationCode 反查该站点下的供应商：那张表的 station_code 大量为空（老的全局配置），
     * 反查会把整站的供应商静默漏光——聚合出 0 个格子，却照样标记「已结算」。
     */
    pushConfigIds: jsonb('push_config_ids').notNull().default([]),
    /**
     * 每天几点触发结算，HH:mm，**按本行 regionCode 所属州的本地时间**。
     * 默认 16:00：出仓阈值 11:00 + 24h 窗口上界都已过，不会把「窗口还没到期」记成未达标。
     */
    settleTime: varchar('settle_time', { length: 5 }).notNull().default('16:00'),
    isEnabled: boolean('is_enabled').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('dispatch_performance_configs_station_unique').on(table.stationCode),
  ],
)

export type DispatchPerformanceConfig = typeof dispatchPerformanceConfigs.$inferSelect
export type NewDispatchPerformanceConfig = typeof dispatchPerformanceConfigs.$inferInsert

/**
 * 结算台账：记录「某站点某到件日的两趟结算各自跑过没」，与「跑出来有没有数据」分开。
 *
 * 不分拣的工作日 inbound/query 本就没数据、聚合出 0 个格子；若靠日度表有没有行判重，
 * 这类日期会被每天重新拉一遍直到滑出回看窗口。台账只认「跑过」这个事实。
 */
export const dispatchPerformanceSettledBatches = pgTable(
  'dispatch_performance_settled_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    stationCode: varchar('station_code', { length: 64 }).notNull(),
    arrivalDate: varchar('arrival_date', { length: 10 }).notNull(),
    /** 出仓那一趟（D+1）完成时刻；null = 还没跑 */
    exitSettledAt: timestamp('exit_settled_at', { withTimezone: true }),
    /** 派签那一趟（D+2）完成时刻；null = 还没跑 */
    dispatchSettledAt: timestamp('dispatch_settled_at', { withTimezone: true }),
    /** 最近一趟拉到的运单数与落库格子数，供排查「这天为什么没数据」 */
    waybillCount: integer('waybill_count').notNull().default(0),
    cellCount: integer('cell_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('dispatch_performance_settled_batches_unique').on(
      table.stationCode,
      table.arrivalDate,
    ),
  ],
)

export type DispatchPerformanceDailyStat = typeof dispatchPerformanceDailyStats.$inferSelect
export type NewDispatchPerformanceDailyStat = typeof dispatchPerformanceDailyStats.$inferInsert
export type DispatchPerformanceSettledBatch = typeof dispatchPerformanceSettledBatches.$inferSelect
