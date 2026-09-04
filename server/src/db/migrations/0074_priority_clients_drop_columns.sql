-- 优先客户配置：只保留商家编码/名称与 VIP 标记，去掉负责人、开户时间、销售团队
ALTER TABLE "priority_clients" DROP COLUMN IF EXISTS "director";
ALTER TABLE "priority_clients" DROP COLUMN IF EXISTS "account_opened_at";
ALTER TABLE "priority_clients" DROP COLUMN IF EXISTS "sales_team";
