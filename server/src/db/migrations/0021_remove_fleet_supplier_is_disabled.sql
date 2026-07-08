-- 将全局「已启用」供应商迁入出仓告警定时列表，再移除主配置表的 is_disabled

UPDATE "exit_alarm_schedules" s
SET "push_config_ids" = (
  SELECT COALESCE(jsonb_agg(f."id" ORDER BY f."created_at"), '[]'::jsonb)
  FROM "fleet_supplier_push_configs" f
  WHERE f."is_disabled" = false AND trim(f."webhook_url") <> ''
)
WHERE COALESCE(jsonb_array_length(s."push_config_ids"), 0) = 0;--> statement-breakpoint

ALTER TABLE "fleet_supplier_push_configs" DROP COLUMN IF EXISTS "is_disabled";
