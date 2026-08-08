-- 11点前出仓告警新增「路由码白名单数据推送」开关：勾选后在同一张卡片里附加白名单路由的出仓数据
ALTER TABLE "exit_alarm_schedules" ADD COLUMN IF NOT EXISTS "route_code_whitelist_push_enabled" boolean DEFAULT false NOT NULL;
