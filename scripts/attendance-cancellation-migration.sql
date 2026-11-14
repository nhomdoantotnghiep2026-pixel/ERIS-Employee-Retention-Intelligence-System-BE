-- Execute as attendance table owner. No attendance rows are deleted.
BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS record_status varchar(20);
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS cancellation_reason text;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS cancelled_by integer;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
UPDATE public.attendance SET record_status='ACTIVE' WHERE record_status IS NULL;
ALTER TABLE public.attendance ALTER COLUMN record_status SET DEFAULT 'ACTIVE';
ALTER TABLE public.attendance ALTER COLUMN record_status SET NOT NULL;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.attendance'::regclass AND conname='attendance_record_status_check') THEN
  ALTER TABLE public.attendance ADD CONSTRAINT attendance_record_status_check CHECK(record_status IN ('ACTIVE','CANCELLED'));
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.attendance'::regclass AND conname='attendance_cancelled_by_fk') THEN
  ALTER TABLE public.attendance ADD CONSTRAINT attendance_cancelled_by_fk FOREIGN KEY(cancelled_by) REFERENCES public.users(id);
 END IF;
END $$;
ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS uq_attendance_employee_date;
CREATE UNIQUE INDEX IF NOT EXISTS attendance_active_employee_date_uq ON public.attendance(employee_id,work_date) WHERE record_status='ACTIVE';
COMMIT;
