const {fail}=require('./leave-records.validation');
const projection=`l.*,to_char(l.start_date,'YYYY-MM-DD') AS start_date,to_char(l.end_date,'YYYY-MM-DD') AS end_date`;
async function lockEmployee(db,id){await db.query("SELECT pg_advisory_xact_lock(hashtext('leave-records:' || $1::text))",[id]);}
async function assertNoLeave(db,id,date){const {rows}=await db.query(`SELECT id,start_date::text,end_date::text FROM employee_leave_records WHERE employee_id=$1 AND record_status='ACTIVE' AND start_date<=$2::date AND end_date>=$2::date`,[id,date]);if(rows.length)fail('LEAVE_CONFLICT','Attendance overlaps active Leave Records.',409,rows);}
class LeaveRecordsRepository {
 constructor(pool){this.pool=pool;}
 async transaction(work){const db=await this.pool.connect();try{await db.query('BEGIN');const result=await work(db);await db.query('COMMIT');return result;}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();}}
 async actor(db,id,hr=true){const {rows}=await db.query(`SELECT u.id,u.employee_id,r.name AS role FROM users u JOIN role r ON r.id=u.role_id WHERE u.id=$1 AND u.status='ACTIVE' FOR SHARE OF u,r`,[id]);const a=rows[0];if(!a)fail('UNAUTHORIZED','An active account is required.',401);if(!['HR','EMPLOYEE'].includes(a.role)||hr&&a.role!=='HR')fail('FORBIDDEN','Only HR can manage Leave Records.',403);return a;}
 async types(db){
 const schema=await db.query("SELECT 1 FROM pg_attribute WHERE attrelid='leave_types'::regclass AND attname='code' AND NOT attisdropped");
 if(!schema.rows.length)fail('LEAVE_TYPE_SCHEMA_MISMATCH','leave_types.code is missing from the configured database. The agreed schema is required for code-based import.',503);
 return (await db.query('SELECT id,code,name,description FROM leave_types ORDER BY code')).rows;
 }
 async find(db,id){const row=(await db.query(`SELECT ${projection} FROM employee_leave_records l WHERE id=$1`,[id])).rows[0];if(!row)fail('NOT_FOUND','Leave Record not found.',404);return row;}
 async validate(db,row,exclude=null,duplicate=false){
 if(!(await db.query('SELECT id FROM employees WHERE id=$1 FOR SHARE',[row.employee_id])).rows.length)fail('EMPLOYEE_NOT_FOUND','Employee not found.');
 if(!(await db.query('SELECT id FROM leave_types WHERE id=$1 FOR SHARE',[row.leave_type_id])).rows.length)fail('LEAVE_TYPE_NOT_FOUND','Leave Type not found.');
 const overlaps=(await db.query(`SELECT ${projection} FROM employee_leave_records l WHERE employee_id=$1 AND record_status='ACTIVE' AND ($4::int IS NULL OR id<>$4) AND start_date<=$3::date AND end_date>=$2::date`,[row.employee_id,row.start_date,row.end_date,exclude])).rows;
 if(duplicate&&overlaps.some(l=>l.leave_type_id===row.leave_type_id&&l.start_date===row.start_date&&l.end_date===row.end_date&&(l.reason||null)===(row.reason||null)))return 'DUPLICATE';
 if(overlaps.length)fail('LEAVE_CONFLICT','Overlaps active Leave Records.',409,overlaps);
 const attendance=(await db.query(`SELECT id AS attendance_id,work_date::text,check_in,check_out FROM attendance WHERE employee_id=$1 AND work_date BETWEEN $2::date AND $3::date AND record_status='ACTIVE' AND (check_in IS NOT NULL OR check_out IS NOT NULL OR COALESCE(working_minutes,0)>0 OR COALESCE(overtime_minutes,0)>0)`,[row.employee_id,row.start_date,row.end_date])).rows;
 if(attendance.length)fail('ATTENDANCE_CONFLICT','Leave Record overlaps existing Attendance.',409,attendance);return 'VALID';}
 async insert(db,row,actor){const {rows}=await db.query(`INSERT INTO employee_leave_records(employee_id,leave_type_id,start_date,end_date,reason,record_status,recorded_by) VALUES($1,$2,$3,$4,$5,'ACTIVE',$6) RETURNING id`,[row.employee_id,row.leave_type_id,row.start_date,row.end_date,row.reason||null,actor.id]);return this.find(db,rows[0].id);}
}
module.exports={LeaveRecordsRepository,lockEmployee,assertNoLeave,projection};
