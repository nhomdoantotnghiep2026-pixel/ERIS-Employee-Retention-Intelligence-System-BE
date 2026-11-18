BEGIN;
ALTER TABLE prediction_results DROP CONSTRAINT IF EXISTS chk_prediction_risk;
ALTER TABLE prediction_results ADD CONSTRAINT chk_prediction_risk
  CHECK (risk_level IN ('LOW','MEDIUM','HIGH','CRITICAL','REVIEW_REQUIRED','NO_ALERT'));
COMMIT;
