# Alert display and persistence — 2026-11-10

Threshold: raw score >= 0.099. New results use REVIEW_REQUIRED / NO_ALERT;
prediction_label is an alert flag, not confirmation of future resignation.
Applied scripts/ai-alert-status.sql to permit these values while preserving legacy levels.

Live HR API test on backend port 3002 against AI service port 8000:

- Employee 3, existing snapshot 4; POST predict with save=true returned 200.
- Saved prediction 5 and run 5. GET /api/ai/results/5 returned 200.
- Raw model score 0.2420712404519145; database score 0.242071.
- Label true; risk_level REVIEW_REQUIRED; display label Cần HR xem xét.
- Details: 24.21/100; threshold 9.9/100.
- Direct database reads confirmed zero NULL fields across prediction_results,
  model_run and all 12 explainable rows. Explanation ranks are 1 through 12.
- Run name generated from employee and snapshot date; period defaults to Jan 1
  through snapshot date when legacy snapshot metadata has no period.
- Inference started_at/completed_at are recorded; run COMPLETED, created_by 8.
- Threshold, full-precision model score, base value, SHAP units, assessment label
  and inference timestamps are retained in audit metadata.
- No credentials or access tokens are stored in this report.

UI now emphasizes the alert label, shows five translated feature names, and moves
numeric score/base/raw response under expandable details. UI syntax checked;
browser interaction was not verified in this test.

14 tests passed including PostgreSQL temporary-table persistence and atomic rollback.
The live case reused an old snapshot; its historical feature consistency and model
quality are not validated by this integration test. Existing predictions are unchanged.
Backend port 3000 still needs its existing AI_SERVICE_KEY configuration corrected
and a restart to serve the new behavior; the test process on 3002 has the key in memory.
