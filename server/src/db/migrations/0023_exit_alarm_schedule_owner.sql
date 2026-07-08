-- 出仓告警定时配置改为按账号隔离：每个账号最多一条，userId 唯一
ALTER TABLE "exit_alarm_schedules" ADD COLUMN IF NOT EXISTS "user_id" uuid REFERENCES "users"("id") ON DELETE CASCADE;

-- 历史遗留的全局单条配置：尽量归属给最后保存过它的账号，避免升级后直接消失
UPDATE "exit_alarm_schedules" SET "user_id" = "updated_by" WHERE "user_id" IS NULL AND "updated_by" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "exit_alarm_schedules_user_id_unique" ON "exit_alarm_schedules" ("user_id");

-- 曾经临时加过的 region_code 列改为直接读账号自身 regionCode，不再单独存储
ALTER TABLE "exit_alarm_schedules" DROP COLUMN IF EXISTS "region_code";

-- push_config_ids 改为统一走 supplier_config_scope_bindings（与 vendor-analysis.push 等其他 scope 一致），
-- 迁移历史遗留单条配置里的启用列表，避免升级后清空
INSERT INTO "supplier_config_scope_bindings" ("scope_key", "enabled_config_ids", "updated_at")
SELECT 'exit-alarm.scheduled', "push_config_ids", now()
FROM "exit_alarm_schedules"
WHERE COALESCE(jsonb_array_length("push_config_ids"), 0) > 0
ORDER BY "created_at" ASC
LIMIT 1
ON CONFLICT ("scope_key") DO NOTHING;

ALTER TABLE "exit_alarm_schedules" DROP COLUMN IF EXISTS "push_config_ids";
