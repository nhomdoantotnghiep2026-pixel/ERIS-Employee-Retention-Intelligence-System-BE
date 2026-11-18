# Live AI happy case — 2026-11-10

Authenticated through the HR login API. No credentials or tokens are stored here.
Test backend: http://127.0.0.1:3001; AI service: http://127.0.0.1:8000.
Backend service key was loaded in process memory from the existing AI service configuration.
The backend on port 3000 was not reconfigured.

POST /api/ai/employees/3/predict with {"snapshotId":4,"save":true} returned 200.
GET /api/ai/results/4 returned 200. Direct PostgreSQL reads confirmed:

- prediction_results.id = 4, prediction_run_id = 4, employee_id = 3, snapshot_id = 4.
- model_run.status = COMPLETED.
- Model score = 0.24207124045191444; persisted NUMERIC value = 0.242071.
- 12 explainable rows, ranks 1–12, directions INCREASE.
- risk_level and prediction_label remain NULL; no validated decision thresholds.
- SHAP base = 0.09994679166666662; additivity error = 2.498001805406602e-16.
- Model = mexwell-rf12-demo-v1-20e0a090ced2; validation = NO_QUALIFIED_MEXWELL_MODEL.

Largest contributions, in probability percentage points:

| Feature | Contribution |
|---|---:|
| Hire_Date | +3.7774 |
| Employee_Satisfaction_Score | +2.8776 |
| Monthly_Salary | +1.3760 |
| Sick_Days | +1.3660 |
| Age | +1.2613 |

This exercised real inference and persisted real model responses using an existing snapshot.
It did not validate that snapshot's business provenance. Snapshot 4 contains Hire_Date
2014-09-07 and Years_At_Company 10 at a 2026 snapshot, which does not match the newly
agreed completed-year calculation. Current employee data also differs from this snapshot.
Current employee 3 preview returns 200 but lacks Department, Gender, Age, Education_Level,
Monthly_Salary and Employee_Satisfaction_Score. No values were fabricated to fill these.

During live preview, an alias collision in scheduleSql caused column a.work_date does not
exist. Renaming the outer attendance alias to att fixed it; live preview then returned 200.
The 3 source assembly unit tests passed after the fix.

Recommendation: persist raw model probability and all signed SHAP values; display only
the top contributors as explanation of model behavior. Do not choose risk/label thresholds
from a single case. Base value and SHAP units currently live in audit metadata; an explicit
base-value field would help if explanation APIs later stop depending on audit metadata.
The monthly/YTD feature definition changes need model validation before operational use.
