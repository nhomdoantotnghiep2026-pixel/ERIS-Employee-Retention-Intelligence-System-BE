# Attendance Management — Excel import

Attendance now uses HR-provided Excel data. The running server no longer mounts GPS check-in/check-out or close-day, and no longer runs automatic ABSENT/calendar/leave materialization jobs. Existing leave, holiday and company-location endpoints remain available for their independent features; existing legacy Attendance rows are retained.

## Setup

```sh
npm run db:migrate:attendance
npm run test:attendance
npm run check:attendance
npm start
```

The migration is repeatable and preserves existing Attendance and schedule data. Run it before starting the new version. Restart any old backend process so that the previous absence-generation interval stops.

Set each importable Work Schedule's unique `shift_type` using `PATCH /api/work-schedules/:id`. Existing schedules intentionally have no guessed code. HR can also map them from `/attendance-demo`. Create an overnight schedule through the existing Work Schedule API:

```json
{
  "name": "Ca đêm",
  "shift_type": "NIGHT",
  "start_time": "22:00",
  "end_time": "06:00",
  "break_start": "02:00",
  "break_end": "03:00",
  "working_days": [1, 2, 3, 4, 5],
  "attendance_policy": {
    "early_arrival_minutes": 240,
    "late_arrival_minutes": 480,
    "early_departure_minutes": 480,
    "late_departure_minutes": 480,
    "unusual_duration_minutes": 960,
    "max_duration_minutes": 1440
  }
}
```

These are configurable technical defaults, not legal/payroll rules. Both break fields may be null for a shift without breaks. The break must fit entirely inside the shift timeline. A shift cannot have equal start/end times. Currently assigned schedules retain restrictions on changing time fields; their code and import policy can be edited. Assignment for other features uses employees.work_schedule_id; default scheduling is retired and no automatic scheduling job runs.

## Excel and Preview

First worksheet, first row headers:

```text
employee_code | employee_name | shift_type | check_in            | check_out
EMP003        |               | NIGHT      | 2026-11-16 22:15:00 | 2026-11-17 06:10:00
```

`employee_name` is optional. Accepts strict datetime strings or actual Excel date cells (1900/1904 workbooks); formulas and locale-dependent strings are rejected. Limit 10 MiB, 10,000 data rows and 100 columns. Workbook is parsed in memory and the normalized Preview is persisted in PostgreSQL for 24 hours. Raw files are not stored. Timestamps are interpreted as Vietnam wall time and stored as TIMESTAMP WITHOUT TIME ZONE; API returns explicit +07:00.

API prefixes: `/api/v1/attendance` (existing) and `/api/attendance` (alias). Authenticate with an ERIS access token. Current authorization matches the repository: all active HR accounts manage all employees, while Employee reads are constrained to their linked employee ID. No department-level HR permission model is introduced.

1. `POST /import/preview`, multipart `file`: no Attendance is written.
2. `GET /import/:batchId`: retrieve persisted Preview and old/new differences.
3. `PATCH /import/:batchId/rows/:excelRow`, body `{ "work_date": "2026-11-16" }` selects a matching candidate; `{ "exclude": true }` excludes a row. Each change recalculates the whole Preview against current data.
4. `POST /import/:batchId/confirm`:

```json
{
  "duplicate_strategy": "SKIP",
  "confirm_warnings": true,
  "updates": [
    { "excel_row": 5, "action": "UPDATE", "reason": "Điều chỉnh theo file chấm công mới" }
  ]
}
```

ERROR and unresolved rows must be corrected/excluded. NO_DATA and INCOMPLETE never create Attendance and are counted in excluded rows. Warnings require acknowledgment; an ambiguous shift requires a specific candidate and cannot be bypassed by `confirm_warnings`. Identical duplicates skip. Changed duplicates skip unless explicitly selected for update with a reason. Conflicting rows in one file must be reduced to one row per employee/date. Cancelled Attendance cannot be overwritten or restored by import.

Confirm is atomic for all included rows, locks the batch/schedules/profiles/employee-date keys, checks the complete Preview fingerprint and saves Attendance plus both dedicated/global Audit in one transaction. A stale Preview returns 409. Repeating the same Confirm returns its saved result, without a second Audit. A different decision after Confirm returns 409.

`GET /import/history` lists batches; `GET /import/:batchId/errors` downloads issues as .xlsx. Data is text, not executable formulas.

## Calculation and data management

Work date is the selected scheduled start date. NIGHT 16/11 22:15 → 17/11 06:10, break 02–03, yields 415 working minutes, late 15, early 0. A 17/11 00:15 check-in belongs to 16/11 when it uniquely matches that shift's windows. Checkout dates are never altered.

Working minutes count actual presence minus overlapping break time. Late and early are clock differences, never offset against each other. `outside_shift_minutes` is separate; `overtime_minutes` defaults to 0. Imported `attendance_status` is PRESENT, while import validation states remain in the batch. Missing input never creates ABSENT.

- `GET /`, `GET /me`: paginated list (`from`, `to`, `record_status=ACTIVE|CANCEL|ALL`, `limit<=200`, `offset`). Employee `/me` ignores any supplied employee_id and uses the account's ID.
- `GET /summary`: only ACTIVE records, scoped to the employee when caller is not HR. `recorded_days` counts actual rows, not inferred absences.
- `GET /:id`: HR or owner. `GET /:id/audit-logs`: HR, pagination.
- `PATCH /:id`: `check_in` and/or `check_out`, `expected_version`, `reason`. Uses the original saved schedule snapshot and recalculates all metrics. Cannot manually patch metrics or move work_date.
- `PATCH /:id/cancel` and `/restore`: `expected_version`, `reason`. Soft cancellation retains the unique employee/date key; each transition creates Audit.

Legacy rows without a snapshot are readable and cancellable. To edit their timestamp pair, reconcile through a new import with an explicit UPDATE reason. Restore requires a valid pair and snapshot. Schedule changes do not recalculate historical records.

The demo at `/attendance-demo` supports login, upload, Preview, candidate choice, exclusion, old/new differences, update reasons, warnings, Confirm, batch history/error export, filtered attendance, summary and edit/cancel/restore/Audit. Employee sees only personal data.

## Verification

`test/attendance-import.test.cjs` covers the numeric HC/NIGHT examples, invalid breaks/dates, candidate ambiguity and Excel date systems. `test/attendance-import.db.test.cjs` creates a unique disposable PostgreSQL schema, applies the actual migration twice, and verifies Preview states, idempotence, duplicate decisions, concurrent imports from two HR users, stale data, snapshot history, mutation Audit, full rollback on Audit failure, permissions and HTTP upload/routes. It drops only its own generated schema; it does not modify employee/Attendance data in public.

Tests for dated/default assignments describe a retired contract. `npm run test:work-schedules` verifies the merged current-FK contract, overnight configuration, metadata edits and audit rollback. Attendance import remains independent of employee assignments. Browser interaction for the replaced demo has not been automated.
