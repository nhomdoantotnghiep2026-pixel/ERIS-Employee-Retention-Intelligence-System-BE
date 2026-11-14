# Attendance import

Requires employees.work_schedule_id referencing work_schedules.id.
No shift_type or schedule_id column is added to attendance.

POST `/api/v1/attendance/import`, Bearer token of an ACTIVE HR account.
Multipart field `file`: one XLSX, maximum 5 MB, one sheet, 1–10000 nonblank rows.

Headers (row 1, exact order):
`employee_id, attendance_date, shift_type, attendance_status, login_timestamp, logout_timestamp, total_hours_worked, late_arrival_mins, early_exit_mins, overtime_hours, leave_type`

`employee_id` means employee CODE, for example EMP009. Numeric database IDs are not accepted.
Dates: YYYY-MM-DD. Timestamps: YYYY-MM-DD HH:mm:ss in Vietnam local time;
native Excel date/time cells are also supported as local wall-clock values.
Numeric metrics must be numeric Excel cells. Hours are converted to rounded whole minutes.
Total hours exclude breaks and include overtime; do not add overtime again.
Overnight records may last up to 24 hours; login calendar date must equal attendance_date.

Allowed statuses: PRESENT, LATE, EARLY_LEAVE, LATE_EARLY_LEAVE, ABSENT, ON_LEAVE, HOLIDAY.
The last three require blank timestamps and zero metrics. Only ON_LEAVE accepts/requires leave_type.
Late/early minutes must agree with status. No automatic absence or holiday generation occurs at server startup.

Match employee code to employees.id, then employees.work_schedule_id to work_schedules.id.
Require a valid referenced schedule and matching shift_type. The file shift_type is validation-only.
There is no fallback to default schedules. Historical inactive employees/schedules remain importable.
This checks the employee's current schedule; changing it later changes dashboard joins for old dates.
Historical schedule reconstruction is unavailable without a separate history source.
The imported metrics are checked against shift boundaries. Late/early minutes use whole minutes,
with no grace period. Total hours subtract only the overlapping scheduled break and include overtime.
Overtime counts time after the assigned schedule's end_time (not a fixed 17:00), excluding the break; early arrival is a warning and is
not overtime. Decimal hours tolerate a one-minute rounding difference. Mismatched status or metrics
reject the row and report expected/provided values. No automatic correction is made.
Rows outside working_days are rejected except HOLIDAY. No overnight shift definitions are supported
by schedule creation (start < break start < break end < end). Arrival intervals may span up to 24h.
Intervals overlapping another file row or stored attendance on another date are rejected.
Warnings on successful rows are returned and stored in audit for HR review.
For 09:00–18:00 with a 12:00–13:00 break: 8 net work hours, zero OT at 18:00;
checkout 19:00 gives 9 net hours including 1 OT hour. With both break fields null,
09:00–18:00 gives 9 net hours and zero OT. Database owner must run
scripts/work-schedules-optional-break.sql to enable null breaks in the current schema.
Partial break overlap alone is subtracted. Every timestamp second is used to determine status;
late/early minute counts are floored, so a subminute deviation can have status LATE/EARLY_LEAVE
with zero whole minutes. There is no configured grace period.

Duplicate employee/date in the file: reject all occurrences. Existing employee/date in DB:
reject without overwrite. Valid rows and their audits are committed together; invalid rows
are returned in results with row, employeeCode, field and message. Unexpected SQL/audit failure
rolls back all writes and returns an error, not a partial success.

Response: `{total,created,failed,results:[{row,status,id?,employeeCode?,errors?:[{field,message,expected?}]}]}`.
Filter FAILED results to show HR the rows to correct and re-upload.

Removed HTTP write endpoints: check-in, check-out, close-day. Existing history endpoints remain.
