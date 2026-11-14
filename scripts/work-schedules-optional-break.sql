-- Optional: table owner runs this to allow shifts without an unpaid break.
BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE public.work_schedules ALTER COLUMN break_start DROP NOT NULL;
ALTER TABLE public.work_schedules ALTER COLUMN break_end DROP NOT NULL;
ALTER TABLE public.work_schedules DROP CONSTRAINT IF EXISTS chk_schedule_times;
ALTER TABLE public.work_schedules ADD CONSTRAINT chk_schedule_times CHECK(
 start_time<end_time AND ((break_start IS NULL AND break_end IS NULL) OR
 (break_start IS NOT NULL AND break_end IS NOT NULL AND start_time<break_start AND break_start<break_end AND break_end<end_time))
);
COMMIT;
