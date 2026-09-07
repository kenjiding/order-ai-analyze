-- 容器品类字典：品类从代码常量搬进表，可新增/改名/停用。
-- code 是流转与台账里存的裸字符串，由后端自动生成、不暴露给用户，建成后不可改；
-- 有引用的品类只能停用不能删。列表按 created_at 排序，不设人工排序位。
-- 手写迁移（drizzle-kit generate 需要 TTY），因此所有语句写成幂等的。
CREATE TABLE IF NOT EXISTS "container_types" (
	"code" varchar(32) PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- 原本硬编码的两个品类作为初始数据；DO NOTHING 保证改过的名字不会被重跑覆盖
INSERT INTO "container_types" ("code", "name") VALUES
	('BIG_BASKET', '大蓝筐'),
	('SILVER_BOX', '银筐')
ON CONFLICT ("code") DO NOTHING;
