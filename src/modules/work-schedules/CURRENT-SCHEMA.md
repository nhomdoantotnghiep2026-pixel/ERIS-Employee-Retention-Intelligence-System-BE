# Work schedules — attendance import reference

Work schedules are shift definitions used to validate imported attendance. Employees reference their assigned shift through employees.work_schedule_id. No effective-date history, default schedule, delayed default switch or Redis default job is used.

## API

- HR ACTIVE: POST/GET /api/work-schedules, PATCH /api/work-schedules/:id.
- Payload: name, shift_type, start_time, end_time, break_start, break_end, working_days, status. Unknown fields, including attendance_policy/is_default/effective dates, are rejected.
- Required: name, shift_type, start_time, end_time. Break fields must both be null/omitted or satisfy start_time < break_start < break_end < end_time. start_time < end_time; no new overnight shifts.
- shift_type is trimmed and uppercased. Case variants are one code; duplicate codes, including INACTIVE schedules, are rejected. Code writes are serialized within API transactions without schema changes.
- working_days is a unique non-empty array 1–7 (ISO weekdays), default Monday–Friday; status ACTIVE/INACTIVE, default ACTIVE.
- Assigned shifts can be edited, including times, working days and status. Validate the complete merged definition. There is no old restriction based on assignment history or is_default.
- Editing shifts does not rewrite existing attendance or recompute its stored metrics. New imports and source reconciliation use the current definition. Historical effective dates are not inferred.
- Assignment is retained: PUT/GET /api/employees/:id/work-schedule. Only an ACTIVE existing shift can be assigned. Individual creation is a convenience create+assign transaction, not a separate schedule category. Legacy /schedule-assignments aliases refer to the same current FK.
- Old default routes return 410 for HR; no pending_default property is returned by list.

## Existing database fields

No schema/data migration is run. is_default and attendance_policy may still exist in database but are neither managed nor returned by the schedule API. Import validation currently still reads existing attendance_policy/default tolerance values internally; removing those attendance-specific limits is a separate import-rule decision, not part of shift creation/editing. No-break shifts depend on the existing database allowing null break times.
