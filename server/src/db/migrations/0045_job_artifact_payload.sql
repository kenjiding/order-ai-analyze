-- job artifact 从本地文件（artifact_path）改为直接落库（artifact_payload jsonb），
-- 支撑 worker 与 web 分开部署到不同机器时无需共享文件目录
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "artifact_payload" jsonb;
ALTER TABLE "jobs" DROP COLUMN IF EXISTS "artifact_path";
