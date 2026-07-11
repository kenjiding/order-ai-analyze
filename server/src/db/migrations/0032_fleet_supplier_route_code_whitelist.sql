-- 车队供应商推送配置：路由码白名单（可选，多码用空格/逗号分隔，与 route_code 同格式）
ALTER TABLE "fleet_supplier_push_configs" ADD COLUMN IF NOT EXISTS "route_code_whitelist" varchar(1024) NOT NULL DEFAULT '';
