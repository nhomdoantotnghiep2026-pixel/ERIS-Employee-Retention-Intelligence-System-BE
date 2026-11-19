# Leave Records

All routes use the existing `/api` prefix and bearer authentication. No schema migration is introduced. The deployed database must already contain the agreed `leave_types` and `employee_leave_records` tables.

HR: POST /leave-records (201); GET /leave-records; GET /leave-records/summary; GET /leave-records/:id; PATCH /leave-records/:id/cancel; GET /leave-records/cancellations; GET /leave-records/cancellations/:id; POST /leave-records/import/preview; POST /leave-records/import/confirm.

HR and Employee: GET /leave-types. GET /leave-records/me always scopes to the authenticated linked employee, ignoring employee_id filters.

Create accepts employee_id, leave_type_id, start_date, end_date, reason. Update accepts the same fields except employee_id. Server assigns ACTIVE and recorded_by; updates preserve the creator. Arbitrary time fields are rejected. CANCEL records are excluded from conflicts and summaries.

List and summary filters: employee_id, from, to (inclusive overlapping work dates); list also supports record_status=ACTIVE|CANCEL|ALL, limit (1–200, default 50), offset. Summary clips total_days to the requested range, counts only ACTIVE records, and returns total_hours=null because no reliable employee/day schedule assignment is available. Overnight leave uses the shift's starting work_date, never checkout's calendar date.

Import multipart field `file`: .xlsx or UTF-8 CSV, at most 10 MiB / 10,000 rows. Headers: employee_code,leave_type,start_date,end_date,reason (reason optional). Dates: YYYY-MM-DD or Excel date cells. Formulas are rejected. Preview returns fingerprint, summary and per-row VALID/DUPLICATE/CONFLICT/ERROR. Confirm resubmits the identical file plus `fingerprint`; it reparses and revalidates, saves valid rows only, skips duplicates, returns row outcomes and counts. Exact duplicate means same employee, type, dates and normalized reason; only ACTIVE database records match. Duplicate detection precedes overlap checks. No import batch tables or durable preview history are created.

Leave Records writes and Attendance import and cancellation share an employee advisory lock. Batches acquire locks in ascending employee order. Attendance checks active leave again before writing. HR cancels related active ON_LEAVE attendance before cancelling its leave source. Legacy Leave Requests use separate endpoints.

Cancellation accepts a JSON object with a non-empty `reason`. The leave record stores `cancellation_reason` and `cancelled_by`, and history exposes `updated_at` as `cancelled_at`. History supports `employee_id`, `cancelled_by`, `from`, `to`, `page`, and `limit`. Corrections create a new record after cancellation.

Leave type code convention: `LT` plus three incrementing digits, for example `LT001`, `LT002`, `LT003`. The import column `leave_type` contains this code, not the type name such as ANNUAL or SICK. Use GET /api/leave-types to obtain the actual code-to-ID mapping. Manual create/update still use leave_type_id. Leave Records only reads these codes; code generation belongs to the leave type catalogue, and this module does not allocate codes or derive them from names/IDs.

Example CSV:

```csv
employee_code,leave_type,start_date,end_date,reason
EMP009,LT001,2026-11-16,2026-11-18,Personal leave
EMP010,LT002,2026-11-17,2026-11-17,
```

Deployment check (2026-11-16): the connected database returns LT001 through LT012, matching the agreed LT convention. Import matches the actual code returned by the catalogue. Catalogue/import return LEAVE_TYPE_SCHEMA_MISMATCH (503) if the code column is absent.
