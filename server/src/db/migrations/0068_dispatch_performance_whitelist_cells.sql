-- 出仓派签达成分析：白名单路由的数据改为「落库并展示，但不计入供应商/站点的两个率」。
--
-- 原来白名单路由在聚合时就被 isRowInConfigScope 整行剔除，页面上完全看不见 ——
-- 用户想看这些路由跑成什么样（它们只是不参与考核，不是不存在）。
-- 现在改用 isRowInConfigScopeIgnoringWhitelist 收单，命中白名单的格子打上 is_whitelist 标记：
-- 路由码/司机两层照常展示各自指标，供应商行与站点汇总在累加时跳过这些格子。
--
-- 历史数据不回补：本列之前落库的行都是「已剔除白名单」的结果，标记恒为 false，
-- 白名单路由要等下一次结算才会出现。

ALTER TABLE "dispatch_performance_daily_stats" ADD COLUMN IF NOT EXISTS "is_whitelist" boolean DEFAULT false NOT NULL;
