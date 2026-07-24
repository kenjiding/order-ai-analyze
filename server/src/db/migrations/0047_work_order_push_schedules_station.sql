-- 工单推送每条配置新增站点编码，用于过滤该条只检查该站点的未处理工单
ALTER TABLE "work_order_push_schedules" ADD COLUMN IF NOT EXISTS "station_code" varchar(64) DEFAULT '' NOT NULL;
