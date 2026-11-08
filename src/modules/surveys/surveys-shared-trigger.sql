-- Update the existing validator for the shared question bank (scores 1..5).
-- No tables, columns or survey data are added/changed by this definition.
CREATE OR REPLACE FUNCTION public.validate_submitted_survey()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE old_id integer; new_id integer;
BEGIN
  IF TG_OP <> 'INSERT' THEN old_id := OLD.survey_id; END IF;
  IF TG_OP <> 'DELETE' THEN new_id := NEW.survey_id; END IF;
  IF EXISTS (
    SELECT 1 FROM survey_responses r
    WHERE r.survey_id IN (old_id,new_id) AND r.submitted_at IS NOT NULL
      AND (
        NOT EXISTS (SELECT 1 FROM survey_questions)
        OR (SELECT COUNT(*) FROM survey_answers a WHERE a.response_id=r.id)
           <> (SELECT COUNT(*) FROM survey_questions)
        OR EXISTS (
          SELECT 1 FROM survey_questions q
          WHERE NOT EXISTS (
            SELECT 1 FROM survey_answers a
            WHERE a.response_id=r.id AND a.question_id=q.id AND a.survey_id=r.survey_id
              AND a.score BETWEEN 1 AND 5
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'Submitted survey must answer every shared question once with a score from 1 to 5'
      USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$function$;
