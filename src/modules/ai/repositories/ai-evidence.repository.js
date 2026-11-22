async function surveyIdsInPeriod(db, employeeId, period) {
  const { rows } = await db.query(`SELECT DISTINCT r.survey_id FROM survey_responses r
    WHERE r.employee_id=$1
      AND r.submitted_at>=($2::date::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
      AND r.submitted_at<(($3::date+1)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')
    ORDER BY r.survey_id`, [employeeId, period.start, period.end]);
  return rows.map(row => row.survey_id);
}
module.exports = { surveyIdsInPeriod };
