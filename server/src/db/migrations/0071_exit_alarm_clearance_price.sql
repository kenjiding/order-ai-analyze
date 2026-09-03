-- 滞留数据告警：滞留清货价（单件补贴，单位美元）；为空表示不展示清货费用
ALTER TABLE "exit_alarm_schedules" ADD COLUMN IF NOT EXISTS "clearance_price" double precision;
