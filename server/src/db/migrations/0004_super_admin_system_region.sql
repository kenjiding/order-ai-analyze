-- 超级管理员归属 system 区域，与 regions 表及登录/me 接口 join 一致，避免 region_id 为空导致展示异常
UPDATE "users"
SET "region_id" = 'system'
WHERE "role" = 'super_admin' AND ("region_id" IS NULL OR "region_id" = '');
