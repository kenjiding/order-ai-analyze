-- 24H 派签告警新增「司机地图」展示开关，默认关闭
ALTER TABLE "dispatch_alarm_schedules" ADD COLUMN IF NOT EXISTS "show_driver_map" boolean DEFAULT false NOT NULL;
