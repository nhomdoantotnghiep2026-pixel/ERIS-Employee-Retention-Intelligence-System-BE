# Current work schedule contract

Employees hold one nullable work_schedule_id FK to work_schedules.id.
There are no dated assignment rows and no is_default column. Assignment updates are immediate.

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
Time, status, working-day and shift_type changes to currently assigned schedules are blocked;
create a new shift definition and reassign instead. Renaming is allowed.

Import uses the employee's current schedule even for historical attendance. Without historical
schedule data it cannot establish the shift actually used in the past. Warnings/errors must be
reviewed against source records, not resolved by silently changing imported values.

AI schedule lookup now reads the employee FK. Weekly hours still use the current ACTIVE schedule.
Absence totals use imported ON_LEAVE/ABSENT records, excluding active holidays; current working_days
are no longer used to filter historical absences. Existing model semantics remain provisional:
Sick_Days still means all imported absence, not confirmed illness. New model selection is separate.

The former DEFAULT-FLOW.md and dated-assignment tests describe the retired contract;
use attendance-import.test.cjs, import-shift-validation.test.cjs and attendance-import-current.db.test.cjs.
