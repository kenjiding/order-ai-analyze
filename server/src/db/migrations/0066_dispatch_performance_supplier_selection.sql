-- 出仓派签达成分析：统计范围改为在配置里显式勾选供应商。
--
-- 原设计靠 station_code 反查 fleet_supplier_push_configs 得到该站点的供应商，已被实测证伪：
-- 那张表的 station_code 大量为空（老的全局配置）或绑在别的站点上，反查会把整站的供应商漏光。
-- 站点 S210431701 就是这么中招的 —— 9858 单一单都没匹配上，聚合出 0 个格子，
-- 却照样被标记「已结算」，前端只显示运单数、看不出落库 0 行。
--
-- 改为与四个告警同一套 push_config_ids（fleet_supplier_push_configs 的行 id 列表），
-- 用户在配置抽屉里勾选，站点与供应商的关系变成显式的、可见的。
--
-- 代价：漏勾的供应商其历史数据会永久缺失（结算不回补）。配套的安全网是
-- 「拉到运单却聚合出 0 个格子」时直接失败、不写台账，使漏勾当场暴露且能重跑。

ALTER TABLE "dispatch_performance_configs" ADD COLUMN IF NOT EXISTS "push_config_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
