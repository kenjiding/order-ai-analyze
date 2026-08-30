-- 出仓派签达成分析：结算触发时间改为按站点配置。
--
-- 原来是一条全局 cron（18:00 阿德莱德）统一跑所有站点。各站点出仓/派签节奏不同，
-- 现在每条配置自带「触发统计时间」，以该配置所属州（region_code）的本地时间为准，
-- 默认 16:00 —— 晚于出仓 11:00 阈值 + 24h 窗口的上界，不会把「窗口还没到期」记成未达标。
--
-- 调度侧改成每分钟扫一遍，命中各自触发时间的站点才跑（见 jobs/scheduler.ts）。

ALTER TABLE "dispatch_performance_configs" ADD COLUMN IF NOT EXISTS "settle_time" varchar(5) DEFAULT '16:00' NOT NULL;
