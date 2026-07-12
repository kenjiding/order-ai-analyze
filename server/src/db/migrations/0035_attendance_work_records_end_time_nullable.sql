-- 出勤工作时间记录：结束时间改为可空，支持移动端现场打卡时先记录开始时间、稍后再补结束时间。
ALTER TABLE "attendance_work_records" ALTER COLUMN "end_time" DROP NOT NULL;
