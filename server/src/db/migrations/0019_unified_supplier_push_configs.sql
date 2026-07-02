-- 统一供应商推送配置：以出仓告警字段为基准，合并车队推送 / 供应商分析 / 出仓告警三处配置

ALTER TABLE "fleet_supplier_push_configs" ADD COLUMN IF NOT EXISTS "vendor_code" varchar(64) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "fleet_supplier_push_configs" ADD COLUMN IF NOT EXISTS "vendor_name" varchar(255) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "fleet_supplier_push_configs" ADD COLUMN IF NOT EXISTS "supplier_nickname" varchar(255) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "fleet_supplier_push_configs" ADD COLUMN IF NOT EXISTS "push_description" varchar(512);--> statement-breakpoint
ALTER TABLE "fleet_supplier_push_configs" ADD COLUMN IF NOT EXISTS "is_disabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "fleet_supplier_push_configs" ADD COLUMN IF NOT EXISTS "created_by" uuid;--> statement-breakpoint

-- 历史车队配置：supplier_name → supplier_nickname / vendor_name
UPDATE "fleet_supplier_push_configs"
SET
  "supplier_nickname" = COALESCE(NULLIF("supplier_nickname", ''), "supplier_name", ''),
  "vendor_name" = COALESCE(NULLIF("vendor_name", ''), "supplier_name", '')
WHERE "supplier_name" IS NOT NULL;--> statement-breakpoint

-- 先移除 per-user 作用域，改为全局共享配置
ALTER TABLE "fleet_supplier_push_configs" DROP CONSTRAINT IF EXISTS "fleet_supplier_push_configs_user_id_users_id_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "fleet_supplier_push_configs_user_idx";--> statement-breakpoint
ALTER TABLE "fleet_supplier_push_configs" DROP COLUMN IF EXISTS "user_id";--> statement-breakpoint
ALTER TABLE "fleet_supplier_push_configs" DROP COLUMN IF EXISTS "supplier_name";--> statement-breakpoint

-- 出仓告警配置迁入（按 vendor_code 去重，优先保留已有 fleet 行）
INSERT INTO "fleet_supplier_push_configs" (
  "vendor_code", "vendor_name", "supplier_nickname", "route_code",
  "webhook_url", "signing_secret", "push_description", "push_content",
  "is_disabled", "created_by", "created_at", "updated_at"
)
SELECT
  e."vendor_code",
  e."vendor_name",
  e."vendor_name",
  e."route_code",
  e."webhook_url",
  e."signing_secret",
  e."push_description",
  '',
  e."is_disabled",
  e."created_by",
  e."created_at",
  e."updated_at"
FROM "exit_alarm_push_configs" e
WHERE NOT EXISTS (
  SELECT 1 FROM "fleet_supplier_push_configs" f
  WHERE f."vendor_code" = e."vendor_code" AND e."vendor_code" <> ''
);--> statement-breakpoint

-- 供应商分析配置迁入（vendor_code 尚未存在时）
INSERT INTO "fleet_supplier_push_configs" (
  "vendor_code", "vendor_name", "supplier_nickname", "route_code",
  "webhook_url", "signing_secret", "push_description", "push_content",
  "is_disabled", "created_by", "created_at", "updated_at"
)
SELECT
  v."vendor_code",
  v."vendor_name",
  v."vendor_name",
  '',
  v."webhook_url",
  v."signing_secret",
  v."push_description",
  '',
  v."is_disabled",
  v."created_by",
  v."created_at",
  v."updated_at"
FROM "vendor_analysis_push_configs" v
WHERE NOT EXISTS (
  SELECT 1 FROM "fleet_supplier_push_configs" f
  WHERE f."vendor_code" = v."vendor_code" AND v."vendor_code" <> ''
);--> statement-breakpoint

ALTER TABLE "fleet_supplier_push_configs" ADD CONSTRAINT "fleet_supplier_push_configs_created_by_users_id_fk"
  FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

DROP TABLE IF EXISTS "exit_alarm_push_configs";--> statement-breakpoint
DROP TABLE IF EXISTS "vendor_analysis_push_configs";
