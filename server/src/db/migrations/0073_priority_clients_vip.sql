-- 优先客户配置：VIP 标记
ALTER TABLE "priority_clients" ADD COLUMN IF NOT EXISTS "is_vip" boolean NOT NULL DEFAULT false;
