BEGIN;
SELECT pg_advisory_xact_lock(74123, 2);
ALTER TABLE work_schedules ADD COLUMN IF NOT EXISTS shift_type varchar(50);
-- Some existing ERIS databases predate the optional default/assignment features.
ALTER TABLE work_schedules ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS uq_work_schedules_shift_type ON work_schedules(shift_type);
ALTER TABLE work_schedules ADD COLUMN IF NOT EXISTS attendance_policy jsonb NOT NULL DEFAULT
  '{"early_arrival_minutes":240,"late_arrival_minutes":480,"early_departure_minutes":480,"late_departure_minutes":480,"unusual_duration_minutes":960,"max_duration_minutes":1440}';
ALTER TABLE work_schedules ALTER COLUMN break_start DROP NOT NULL;
ALTER TABLE work_schedules ALTER COLUMN break_end DROP NOT NULL;
ALTER TABLE work_schedules DROP CONSTRAINT IF EXISTS chk_schedule_times;
ALTER TABLE work_schedules ADD CONSTRAINT chk_schedule_times CHECK (
  start_time <> end_time AND (
    (break_start IS NULL AND break_end IS NULL) OR
    (break_start IS NOT NULL AND break_end IS NOT NULL AND break_start <> break_end
      AND (break_start - start_time + CASE WHEN break_start < start_time THEN interval '24 hours' ELSE interval '0' END)
        + (break_end - break_start + CASE WHEN break_end < break_start THEN interval '24 hours' ELSE interval '0' END)
        <= (end_time - start_time + CASE WHEN end_time < start_time THEN interval '24 hours' ELSE interval '0' END)))
);
CREATE TABLE IF NOT EXISTS attendance_import_batches (
  id uuid PRIMARY KEY,
  created_by integer NOT NULL REFERENCES users(id),
  filename text NOT NULL, file_hash text NOT NULL,
  status varchar(20) NOT NULL CHECK(status IN ('READY','PREVIEWED','CONFIRMED')),
  rows jsonb NOT NULL, confirm_hash text, result jsonb,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP + interval '24 hours',
  confirmed_at timestamptz
);
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS work_schedule_id integer REFERENCES work_schedules(id) ON DELETE RESTRICT;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS late_mins integer NOT NULL DEFAULT 0 CHECK(late_mins >= 0);
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS early_mins integer NOT NULL DEFAULT 0 CHECK(early_mins >= 0);
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS outside_shift_minutes integer NOT NULL DEFAULT 0 CHECK(outside_shift_minutes >= 0);
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS leave_type varchar(50);
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS record_status varchar(10) NOT NULL DEFAULT 'ACTIVE' CHECK(record_status IN ('ACTIVE','CANCEL'));
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS cancellation_reason text;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS cancelled_by integer REFERENCES users(id);
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS schedule_snapshot jsonb;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS calculation_version varchar(30);
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS source_batch_id uuid REFERENCES attendance_import_batches(id);
CREATE TABLE IF NOT EXISTS attendance_audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  attendance_id bigint NOT NULL REFERENCES attendance(id) ON DELETE RESTRICT,
  action varchar(10) NOT NULL CHECK(action IN ('CREATE','UPDATE','CANCEL','RESTORE')),
  actor_id integer NOT NULL REFERENCES users(id), reason text,
  old_values jsonb, new_values jsonb NOT NULL,
  batch_id uuid REFERENCES attendance_import_batches(id),
  occurred_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(action = 'CREATE' OR length(trim(reason)) > 0 AND reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS attendance_audit_record_idx ON attendance_audit_logs(attendance_id,id);
CREATE INDEX IF NOT EXISTS attendance_import_created_idx ON attendance_import_batches(created_at DESC);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='chk_attendance_import_pair' AND conrelid='attendance'::regclass) THEN
    ALTER TABLE attendance ADD CONSTRAINT chk_attendance_import_pair CHECK (
      calculation_version IS NULL OR
      (check_in IS NOT NULL AND check_out IS NOT NULL AND check_out > check_in
        AND work_schedule_id IS NOT NULL AND schedule_snapshot IS NOT NULL
        AND working_minutes >= 0 AND overtime_minutes >= 0 AND attendance_status='PRESENT'));
  END IF;
END $$;
COMMIT;
