# Current work schedule contract

Employees hold one nullable work_schedule_id FK to work_schedules.id.
There are no dated assignment rows in the current contract. Assignment updates are immediate. A legacy is_default column may exist after the additive Attendance migration; it is not used by current scheduling and no default-schedule job runs.

- POST /api/work-schedules creates a shift (name, shift_type, start_time, end_time,
  break_start, break_end, working_days, status).
- POST /api/work-schedules/individual takes the same fields plus employee_id and creates/assigns atomically.
- GET/PUT /api/employees/:id/work-schedule reads/assigns the current schedule.
  PUT body: {"work_schedule_id":3}.
- Existing schedule-assignments GET/POST paths are compatibility aliases for current schedule only.
  They accept work_schedule_id; effective_from/effective_to are rejected.
- DELETE /api/employees/:id/schedule-assignments/:assignmentId clears the FK;
  assignmentId means current schedule ID, not a deleted assignment-table row ID.
- Default scheduling endpoints return 410 after HR authorization. No background schedule mutation.

Only active HR can mutate. New assignments require ACTIVE schedules. Changes and audit are atomic.
Break times may both be null for a shift without an unpaid break. Current database requires
the table owner to run scripts/work-schedules-optional-break.sql first. A single null break
boundary is rejected. Shift length is determined by start/end, never fixed to eight hours.
Time, status and working-day changes to currently assigned schedules are blocked;
create a new shift definition and reassign instead. Renaming and import metadata (shift_type,
attendance_policy) updates are allowed. Overnight shifts and breaks after midnight are supported.

The active Attendance importer resolves work_schedules by shift_type from Excel, independently
of employees.work_schedule_id. It saves a calculation snapshot for historical edits. Employee
current schedule remains the source for other features such as AI and leave eligibility.
The former one-step importer checked the employee FK; its helpers are retained for compatibility
tests but its HTTP endpoint returns 410. Use /attendance-demo and the Preview/Confirm APIs.

AI schedule lookup now reads the employee FK. Weekly hours still use the current ACTIVE schedule.
Absence totals use imported ON_LEAVE/ABSENT records, excluding active holidays; current working_days
are no longer used to filter historical absences. Existing model semantics remain provisional:
Sick_Days still means all imported absence, not confirmed illness. New model selection is separate.

The former DEFAULT-FLOW.md and dated-assignment tests describe the retired contract;
use attendance-import.test.cjs and attendance-import.db.test.cjs for the active import flow;
attendance-legacy-import.test.cjs, import-shift-validation.test.cjs and attendance-import-current.db.test.cjs preserve the retired helper coverage.
