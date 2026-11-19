const { periodSatisfaction } = require('../surveys/surveys.satisfaction');
const { AppError } = require('../../common/errors/app-error');
const { scheduleSql } = require('../attendance/attendance-schedule');
const {assess}=require('./ai.assessment');
const { FEATURES } = require('./ai.features');
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
  async read(employeeId,opts,today,capturedAt=new Date().toISOString()) {
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const {rows}=await client.query(`SELECT e.id,e.employee_code AS "employeeCode",e.full_name AS "fullName",d.name AS department,e.gender,
        e.date_of_birth::text,e.hire_date::text,e.current_salary,
        (SELECT ed.education_level FROM employee_educations ed WHERE ed.employee_id=e.id AND ed.status='ACTIVE'
          AND ed.education_level IN ('High School','Bachelor','Master','PhD')
          ORDER BY array_position(ARRAY['High School','Bachelor','Master','PhD']::text[],ed.education_level::text) DESC,ed.id DESC LIMIT 1) AS education_level,
        (SELECT count(*)::int FROM employee_job_histories h WHERE h.employee_id=e.id AND h.change_type='PROMOTION' AND h.start_date<=$2::date) AS promotions,
        NULL::numeric AS satisfaction
        FROM employees e LEFT JOIN departments d ON d.id=e.department_id WHERE e.id=$1 AND e.employment_status='ACTIVE'
          AND EXISTS(SELECT 1 FROM users u WHERE u.employee_id=e.id AND u.status='ACTIVE')`,[employeeId,today]);
      if(!rows[0]) throw new AppError(404,'Nhân viên không tồn tại hoặc hồ sơ/tài khoản chưa ACTIVE.');
      rows[0].satisfaction=await periodSatisfaction(client,employeeId,capturedAt,opts.periodStart);
      const period=(await client.query(`WITH schedule AS (
        SELECT s.working_days FROM (${scheduleSql('$1::integer','$2::date')}) s WHERE s.status='ACTIVE'
      ), calendar AS (
        SELECT day::date AS work_date FROM generate_series($3::date::timestamp,$2::date::timestamp,INTERVAL '1 day') day
      ), records AS (
        SELECT a.* FROM attendance a WHERE a.employee_id=$1 AND a.record_status='ACTIVE'
          AND a.work_date BETWEEN $3::date AND $2::date
          AND a.created_at<=$4::timestamptz AND coalesce(a.updated_at,a.created_at)<=$4::timestamptz
      ), classified AS (
        SELECT c.work_date,r.working_minutes,r.work_date IS NOT NULL AS recorded,
          CASE WHEN r.attendance_status IN ('PRESENT','LATE','EARLY_LEAVE','LATE_EARLY_LEAVE')
            THEN r.working_minutes>=0 AND r.check_in IS NOT NULL AND r.check_out IS NOT NULL
              AND r.check_out>=r.check_in AND r.check_out<=($4::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')
            ELSE r.attendance_status IN ('ABSENT','ON_LEAVE','HOLIDAY')
          END AS complete,
          r.attendance_status IN ('PRESENT','LATE','EARLY_LEAVE','LATE_EARLY_LEAVE') AS worked
        FROM calendar c LEFT JOIN records r USING(work_date)
      )
      SELECT CASE WHEN EXISTS(SELECT 1 FROM schedule) AND count(*) FILTER(WHERE recorded)>0
        AND NOT bool_or(CASE WHEN recorded THEN complete IS NOT TRUE ELSE
          EXISTS(SELECT 1 FROM schedule s WHERE extract(isodow FROM c.work_date)::int=ANY(s.working_days))
          AND c.work_date >= $5::date
          AND NOT EXISTS(SELECT 1 FROM holidays h WHERE h.status='ACTIVE' AND c.work_date BETWEEN h.start_date AND h.end_date)
          AND NOT EXISTS(SELECT 1 FROM employee_leave_records l WHERE l.employee_id=$1 AND l.record_status='ACTIVE'
            AND c.work_date BETWEEN l.start_date AND l.end_date
            AND l.created_at<=$4::timestamptz AND coalesce(l.updated_at,l.created_at)<=$4::timestamptz)
        END) THEN coalesce(sum(working_minutes) FILTER(WHERE worked),0) END AS period_working_minutes
      FROM classified c`,[employeeId,today,opts.periodStart,capturedAt,rows[0].hire_date])).rows[0];
      Object.assign(rows[0],period);
      const stats=(await client.query(`SELECT
        sum(att.overtime_minutes) FILTER(WHERE att.check_in IS NOT NULL AND att.check_out IS NOT NULL
          AND att.check_out <= ($3::timestamptz AT TIME ZONE 'Asia/Ho_Chi_Minh')
          AND att.check_out>=att.check_in AND att.overtime_minutes>=0
          AND att.attendance_status IN ('PRESENT','LATE','EARLY_LEAVE','LATE_EARLY_LEAVE')) AS ytd_overtime_minutes,
        CASE WHEN count(*)>0 THEN count(DISTINCT att.work_date) FILTER(WHERE att.attendance_status='ON_LEAVE') END AS absence_days
        FROM attendance att
        WHERE att.employee_id=$1 AND att.record_status='ACTIVE' AND att.work_date BETWEEN date_trunc('year',$2::date::timestamp)::date AND $2::date
          AND att.created_at<=$3::timestamptz AND coalesce(att.updated_at,att.created_at)<=$3::timestamptz`,
        [employeeId,today,capturedAt])).rows[0];
      Object.assign(rows[0],stats);
      await client.query('COMMIT');
      return rows[0];
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async save(actorId,preview,result) {
    result=assess(result);
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.assertHr(actorId,client,true);
      const employeeId=preview.employee.id;
      const active=await client.query(`SELECT e.id,u.id AS user_id FROM employees e JOIN users u ON u.employee_id=e.id
        WHERE e.id=$1 AND e.employment_status='ACTIVE' AND u.status='ACTIVE' FOR SHARE OF e,u`,[employeeId]);
      if(!active.rows.length) throw new AppError(409,'Nhân viên không còn ACTIVE; không lưu kết quả.');
      const snapshot={id:preview.snapshotId};
      if(!snapshot.id)throw new AppError(409,'Phải tạo hoặc chọn snapshot trước khi lưu dự đoán.');
      const current=await this.readSnapshot(actorId,employeeId,snapshot.id,client,true);
      if(FEATURES.some(key=>current.features[key]!==preview.features[key]))throw new AppError(409,'Snapshot đã bị thay đổi trong lúc chạy model. Hãy chạy lại.');
      const prediction=(await client.query(`INSERT INTO prediction_results(employee_id,snapshot_id,attrition_probability,risk_level,prediction_label)
        VALUES($1,$2,$3,$4,$5) RETURNING id`,[employeeId,snapshot.id,result.score,result.riskLevel,result.predictionLabel])).rows[0];
      const ranked=Object.entries(result.contributions).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));
      for(const [i,[key,value]] of ranked.entries()) await client.query(`INSERT INTO explainable(prediction_result_id,feature_name,feature_value,impact_value,impact_direction,rank_order) VALUES($1,$2,$3,$4,$5,$6)`,[prediction.id,key,String(preview.features[key]),value,value>0?'INCREASE':value<0?'DECREASE':'NEUTRAL',i+1]);
      await client.query(`INSERT INTO audit_logs(user_id,entity_type,entity_id,action,new_value) VALUES($1,'AI_PREDICTION',$2,'CREATE',$3::jsonb)`,[actorId,prediction.id,JSON.stringify({model:result,preview})]);
      await client.query('COMMIT');
      return {predictionId:prediction.id,snapshotId:snapshot.id};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async results(actorId,employeeId) {
    await this.assertHr(actorId);
    const {rows}=await this.pool.query(`SELECT p.id AS "predictionId",p.snapshot_id AS "snapshotId",p.created_at AS "createdAt"
      FROM prediction_results p
      WHERE p.employee_id=$1 AND EXISTS (
        SELECT 1 FROM audit_logs a
        WHERE a.entity_type='AI_PREDICTION' AND a.entity_id=p.id AND a.action='CREATE'
      )
      ORDER BY p.created_at DESC,p.id DESC`,[employeeId]);
    return rows;
  }
  async result(actorId,resultId) {
    await this.assertHr(actorId);
    const {rows}=await this.pool.query(`SELECT p.id,p.snapshot_id AS "snapshotId",p.created_at AS "createdAt",a.new_value AS metadata
      FROM prediction_results p JOIN audit_logs a ON a.entity_type='AI_PREDICTION' AND a.entity_id=p.id AND a.action='CREATE'
      WHERE p.id=$1 ORDER BY a.id DESC LIMIT 1`,[resultId]);
    if(!rows[0]) throw new AppError(404,'Không tìm thấy kết quả AI service đã lưu.');
    const r=rows[0];return {saved:true,predictionId:r.id,snapshotId:r.snapshotId,createdAt:r.createdAt,...r.metadata};
  }
}
require('./ai.snapshot').installSnapshots(AiRepository);
module.exports={AiRepository};
