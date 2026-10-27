-- 容器台账/站点账户按所属州分类展示：复用现有 AU_REGIONS 州枚举，只做展示分类，
-- 不接入按州隔离数据的权限逻辑。存量账户暂为空，补齐后再收紧为必填。
ALTER TABLE "container_accounts" ADD COLUMN IF NOT EXISTS "region_code" varchar(16);
