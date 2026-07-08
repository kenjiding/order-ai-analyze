-- 定时任务幂等抢占记录：所有轮询式定时推送（出仓告警/催派推送/飞书日报等）共用。
-- 调用方确认命中触发条件之后、执行推送等副作用之前，用 (job_key, slot_key) 抢占一次；
-- 插入成功才允许继续，插入失败说明这个时间槽已被别的 worker/重启窗口处理过，直接跳过。

CREATE TABLE IF NOT EXISTS "scheduled_job_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_key" varchar(128) NOT NULL,
	"slot_key" varchar(64) NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_job_claims_job_slot_unique" ON "scheduled_job_claims" USING btree ("job_key","slot_key");
