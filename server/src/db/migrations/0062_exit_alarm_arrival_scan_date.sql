-- 滞留数据告警「立刻推送」可指定到件扫描日期（不填时仍按自动计算的最近工作日兜底）
ALTER TABLE "exit_alarm_schedules" ADD COLUMN IF NOT EXISTS "arrival_scan_date" varchar(10);
