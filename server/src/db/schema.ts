import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
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

export const vendorAnalysisPushConfigs = pgTable('vendor_analysis_push_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  vendorCode: varchar('vendor_code', { length: 64 }).notNull(),
  vendorName: varchar('vendor_name', { length: 255 }).notNull(),
  webhookUrl: varchar('webhook_url', { length: 512 }).notNull(),
  signingSecret: varchar('signing_secret', { length: 255 }),
  pushDescription: varchar('push_description', { length: 512 }),
  isDisabled: boolean('is_disabled').notNull().default(false),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

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
export type VendorAnalysisPushConfig = typeof vendorAnalysisPushConfigs.$inferSelect
export type NewVendorAnalysisPushConfig = typeof vendorAnalysisPushConfigs.$inferInsert
