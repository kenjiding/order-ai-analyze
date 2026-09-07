-- 滞留数据告警 / 24H 派签告警：重要提醒文案，填写后原样追加在推送卡片末尾（勾选 @ 相关人员时 @ 人拼在提醒后面）
ALTER TABLE "exit_alarm_schedules" ADD COLUMN IF NOT EXISTS "important_notice" text;
ALTER TABLE "dispatch_alarm_schedules" ADD COLUMN IF NOT EXISTS "important_notice" text;
