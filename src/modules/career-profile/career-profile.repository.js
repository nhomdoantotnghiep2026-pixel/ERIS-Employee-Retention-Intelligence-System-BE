const {transaction,writeAudit}=require('../audit_logs/repositories/audit.repository');
const columns='id, employee_id AS "employeeId", career_aspiration AS "careerAspiration", goal_description AS "goalDescription", created_at AS "createdAt", updated_at AS "updatedAt", goal_change_reason AS "goalChangeReason", status';
class CareerProfileRepository {
  constructor(pool) {this.pool=pool;}
  transaction(work) {return transaction(this.pool,client=>work(new CareerProfileRepository(client)));}
  async actor(id) {
    const {rows}=await this.pool.query('SELECT u.status,r.name AS role,u.employee_id AS "employeeId" FROM users u JOIN role r ON r.id=u.role_id WHERE u.id=$1 FOR SHARE OF u',[id]);
    return rows[0];
  }
  async employee(id) {
    const {rows}=await this.pool.query('SELECT id,employee_code AS "employeeCode",full_name AS "fullName",employment_status AS status FROM employees WHERE id=$1 FOR SHARE',[id]);
    return rows[0];
  }
  async lockEmployee(id) {await this.pool.query('SELECT pg_advisory_xact_lock(17381,$1::integer)',[id]);}
  async goals(employeeId) {
    const {rows}=await this.pool.query(`SELECT ${columns} FROM employee_career_profiles WHERE employee_id=$1 ORDER BY updated_at DESC,id DESC`,[employeeId]);
    return {currentGoal:rows.find(r=>r.status==='ACTIVE') || null,history:rows.filter(r=>['ACHIEVED','REPLACED','CANCELLED'].includes(r.status))};
  }
  async goal(id,employeeId) {
    const {rows}=await this.pool.query(`SELECT ${columns} FROM employee_career_profiles WHERE id=$1 AND employee_id=$2 FOR UPDATE`,[id,employeeId]);
    return rows[0];
  }
  async insert(employeeId,data,actorId) {
    const {rows}=await this.pool.query(`INSERT INTO employee_career_profiles (employee_id,career_aspiration,goal_description,created_at,updated_at,goal_change_reason,status) VALUES ($1,$2,$3,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,NULL,'ACTIVE') RETURNING ${columns}`,[employeeId,data.careerAspiration,data.goalDescription]);
    await this.audit(actorId,'CREATE',null,rows[0]);return rows[0];
  }
  async update(before,{status=before.status,goalDescription=before.goalDescription,goalChangeReason=null},actorId) {
    const {rows}=await this.pool.query(`UPDATE employee_career_profiles SET status=$3,goal_description=$4,goal_change_reason=$5,updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND employee_id=$2 AND status='ACTIVE' RETURNING ${columns}`,[before.id,before.employeeId,status,goalDescription,goalChangeReason]);
    if(!rows[0]) throw new Error('Locked career goal changed unexpectedly.');
    await this.audit(actorId,'UPDATE',before,rows[0]);return rows[0];
  }
  audit(actorId,action,before,after) {return writeAudit(this.pool,{actorId,entityType:'employee_career_profiles',entityId:after.id,action,oldValue:before,newValue:after});}
  async alerts() {
    const {rows}=await this.pool.query(`SELECT e.id AS "employeeId",e.employee_code AS "employeeCode",count(*)::integer AS "replacementCount",7 AS "windowDays",max(c.updated_at) AS "latestReplacementAt" FROM employee_career_profiles c JOIN employees e ON e.id=c.employee_id WHERE c.status='REPLACED' AND c.updated_at >= CURRENT_TIMESTAMP - INTERVAL '7 days' AND c.updated_at <= CURRENT_TIMESTAMP GROUP BY e.id,e.employee_code HAVING count(*) >= 3 ORDER BY max(c.updated_at) DESC,e.id ASC`);
    return rows;
  }
}
module.exports={CareerProfileRepository};
