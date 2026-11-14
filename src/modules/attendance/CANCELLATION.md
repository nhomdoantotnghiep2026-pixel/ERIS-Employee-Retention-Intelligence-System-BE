# Cancel and reimport attendance

Run scripts/attendance-cancellation-migration.sql as attendance table owner first.
It retains all rows, backfills null record_status to ACTIVE, adds cancelled_at and FK to users,
and replaces uq_attendance_employee_date with a partial unique index for ACTIVE records.
If other uniqueness constraints exist, inspect them before enabling reimport. Unsupported statuses
or broken cancelled_by references cause the migration transaction to roll back.

DELETE /api/v1/attendance/:id with ACTIVE HR bearer token:

```json
{"cancellation_reason":"Nguồn chấm công gửi lại dữ liệu chính xác; hủy bản import nhầm."}
```

The reason is trimmed, required and at most 1000 characters. Unknown fields are rejected.
record_status becomes CANCELLED; cancelled_by references users.id; cancelled_at is server time.
Original metrics are retained. Update plus CANCEL audit are atomic. Repeating cancellation
returns cancelled=false and preserves the original reason, actor and timestamp.
No PATCH/PUT attendance-record endpoint exists. Correct data by cancelling and importing a new row.

GET /api/v1/attendance defaults to ACTIVE. Set recordStatus=CANCELLED or ALL for history.
GET /api/v1/attendance/:id still returns a cancelled record for HR inspection.
Import overlap detection and AI aggregates exclude CANCELLED records. Existing snapshots/results
are not rewritten; generate a new snapshot/prediction when updated source data should be analyzed.

Screen /attendance-import-demo: load attendance, choose Hủy bản ghi, enter a reason.
Select Đã hủy to inspect metadata. Reimport creates a new ID; a second ACTIVE duplicate is rejected.

Verification: node test/attendance-import-current.db.test.cjs uses TEMP tables only and tests
cancellation, repeat cancellation, permission, reason, audit rollback and reimport.
