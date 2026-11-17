BEGIN;
-- Existing eight-column table only. No table or column is created.
LOCK TABLE employee_career_profiles IN ACCESS EXCLUSIVE MODE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_active_career_profile
ON employee_career_profiles (employee_id) WHERE status = 'ACTIVE';
ALTER TABLE employee_career_profiles
DROP CONSTRAINT IF EXISTS employee_career_profiles_employee_id_key;
COMMIT;
