const { AppError } = require('../../common/errors/app-error');
const { FEATURES } = require('./ai.features');
const COLUMNS=['department','gender','age','hire_date','years_at_company','education_level','monthly_salary','work_hours_per_week','overtime_hours','sick_days','promotions','employee_satisfaction_score'];
class AiRepository {
  constructor(pool){this.pool=pool;}
  async assertHr(actorId,client=this.pool,lock=false) {
    const {rows}=await client.query(`SELECT u.id FROM users u JOIN role r ON r.id=u.role_id WHERE u.id=$1 AND u.status='ACTIVE' AND r.name='HR' ${lock?'FOR SHARE OF u':''}`,[actorId]);
    if(!rows.length) throw new AppError(403,'Chỉ HR ACTIVE được sử dụng chức năng AI.');
  }
  async employees(actorId) {
    await this.assertHr(actorId);
    return (await this.pool.query(`SELECT e.id,e.employee_code AS "employeeCode",e.full_name AS "fullName" FROM employees e WHERE e.employment_status='ACTIVE' AND EXISTS(SELECT 1 FROM users u WHERE u.employee_id=e.id AND u.status='ACTIVE') ORDER BY e.id`)).rows;
  }
  async read(employeeId,opts,today) {
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const {rows}=await client.query(`SELECT e.id,e.employee_code AS "employeeCode",e.full_name AS "fullName",d.name AS department,e.gender,
        e.date_of_birth::text,e.hire_date::text,e.current_salary,
        (SELECT ed.education_level FROM employee_educations ed WHERE ed.employee_id=e.id AND ed.status='ACTIVE'
          AND ed.education_level IN ('High School','Bachelor','Master','PhD')
          ORDER BY array_position(ARRAY['High School','Bachelor','Master','PhD']::text[],ed.education_level::text) DESC,ed.id DESC LIMIT 1) AS education_level,
        (SELECT count(*)::int FROM employee_job_histories h WHERE h.employee_id=e.id AND h.change_type='PROMOTION' AND h.start_date<=$2::date) AS promotions,
        (SELECT avg(a.score) FROM survey_answers a WHERE a.response_id=(SELECT sr.id FROM survey_responses sr
          WHERE sr.employee_id=e.id AND sr.submitted_at IS NOT NULL AND (sr.submitted_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date<=$2::date
          ORDER BY sr.submitted_at DESC,sr.id DESC LIMIT 1)) AS satisfaction
        FROM employees e LEFT JOIN departments d ON d.id=e.department_id WHERE e.id=$1 AND e.employment_status='ACTIVE'
          AND EXISTS(SELECT 1 FROM users u WHERE u.employee_id=e.id AND u.status='ACTIVE')`,[employeeId,today]);
      if(!rows[0]) throw new AppError(404,'Nhân viên không tồn tại hoặc hồ sơ/tài khoản chưa ACTIVE.');
      if(opts.periodStart) {
        const stats=(await client.query(`SELECT count(*) FILTER(WHERE check_in IS NOT NULL AND check_out IS NOT NULL AND attendance_status NOT IN ('ON_LEAVE','HOLIDAY')) AS completed_days,
          count(*) FILTER(WHERE check_in IS NOT NULL AND check_out IS NULL) AS incomplete_days,
          COALESCE(sum(working_minutes) FILTER(WHERE check_in IS NOT NULL AND check_out IS NOT NULL AND attendance_status NOT IN ('ON_LEAVE','HOLIDAY')),0) AS working_minutes,
          COALESCE(sum(overtime_minutes) FILTER(WHERE check_in IS NOT NULL AND check_out IS NOT NULL AND attendance_status NOT IN ('ON_LEAVE','HOLIDAY')),0) AS overtime_minutes
          FROM attendance WHERE employee_id=$1 AND work_date BETWEEN $2::date AND $3::date`,[employeeId,opts.periodStart,opts.periodEnd])).rows[0];
        Object.assign(rows[0],stats);
      }
      await client.query('COMMIT');
      return rows[0];
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async save(actorId,preview,result) {
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.assertHr(actorId,client,true);
      const employeeId=preview.employee.id;
      const active=await client.query(`SELECT e.id,u.id AS user_id FROM employees e JOIN users u ON u.employee_id=e.id
        WHERE e.id=$1 AND e.employment_status='ACTIVE' AND u.status='ACTIVE' FOR SHARE OF e,u`,[employeeId]);
      if(!active.rows.length) throw new AppError(409,'Nhân viên không còn ACTIVE; không lưu kết quả.');
      const run=(await client.query(`INSERT INTO model_run(name,period_start,period_end,status,total_employees,model_version,created_by,started_at,completed_at)
        VALUES('Mexwell AI demo — model thật',$1,$2,'COMPLETED',1,$3,$4,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id`,[preview.period?.start??null,preview.period?.end??null,result.model_id,actorId])).rows[0];
      const values=FEATURES.map(k=>preview.features[k]);
      const snapshot={id:preview.snapshotId};
      if(!snapshot.id)throw new AppError(409,'Phải tạo hoặc chọn snapshot trước khi lưu dự đoán.');
      const current=await this.readSnapshot(actorId,employeeId,snapshot.id,client,true);
      if(FEATURES.some(key=>current.features[key]!==preview.features[key]))throw new AppError(409,'Snapshot đã bị thay đổi trong lúc chạy model. Hãy chạy lại.');
      const prediction=(await client.query(`INSERT INTO prediction_results(prediction_run_id,employee_id,snapshot_id,attrition_probability,risk_level,prediction_label)
        VALUES($1,$2,$3,$4,NULL,NULL) RETURNING id`,[run.id,employeeId,snapshot.id,result.score])).rows[0];
      const ranked=Object.entries(result.contributions).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));
      for(const [i,[key,value]] of ranked.entries()) await client.query(`INSERT INTO explainable(prediction_result_id,feature_name,feature_value,impact_value,impact_direction,rank_order) VALUES($1,$2,$3,$4,$5,$6)`,[prediction.id,key,String(preview.features[key]),value,value>0?'INCREASE':value<0?'DECREASE':'NEUTRAL',i+1]);
      await client.query(`INSERT INTO audit_logs(user_id,entity_type,entity_id,action,new_value) VALUES($1,'AI_PREDICTION',$2,'CREATE',$3::jsonb)`,[actorId,prediction.id,JSON.stringify({model:result,preview})]);
      await client.query('COMMIT');
      return {predictionId:prediction.id,runId:run.id,snapshotId:snapshot.id};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async result(actorId,resultId) {
    await this.assertHr(actorId);
    const {rows}=await this.pool.query(`SELECT p.id,p.prediction_run_id AS "runId",p.snapshot_id AS "snapshotId",p.created_at AS "createdAt",a.new_value AS metadata
      FROM prediction_results p JOIN audit_logs a ON a.entity_type='AI_PREDICTION' AND a.entity_id=p.id AND a.action='CREATE'
      WHERE p.id=$1 ORDER BY a.id DESC LIMIT 1`,[resultId]);
    if(!rows[0]) throw new AppError(404,'Không tìm thấy kết quả AI service đã lưu.');
    const r=rows[0];return {saved:true,predictionId:r.id,runId:r.runId,snapshotId:r.snapshotId,createdAt:r.createdAt,...r.metadata};
  }
}
require('./ai.snapshot').installSnapshots(AiRepository);
module.exports={AiRepository};
