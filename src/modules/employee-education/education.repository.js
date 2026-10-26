const { AppError } = require('../../common/errors/app-error');
const columns = `id, employee_id AS "employeeId", CASE WHEN education_level IN ('1','2','3','4') THEN education_level::integer ELSE NULL END AS "educationLevel",
  field_of_study AS "fieldOfStudy", institution, graduation_year AS "graduationYear", status,
  created_at AS "createdAt", updated_at AS "updatedAt"`;
class EducationRepository {
  constructor(pool) { this.pool = pool; }
  async withHrEmployee(actorId, employeeId, write, work) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: users } = await client.query(`SELECT u.status, r.name AS role FROM users u JOIN role r ON r.id=u.role_id WHERE u.id=$1 FOR SHARE OF u`, [actorId]);
      if (users[0]?.status !== 'ACTIVE' || users[0]?.role !== 'HR') throw new AppError(403, 'Only ACTIVE HR can manage employee education.');
      const { rows: employees } = await client.query(`SELECT id, employment_status, to_char(date_of_birth,'YYYY-MM-DD') AS "dateOfBirth" FROM employees WHERE id=$1 FOR SHARE`, [employeeId]);
      if (!employees[0]) throw new AppError(404, 'Employee not found.');
      if (employees[0].employment_status !== 'ACTIVE') throw new AppError(409, 'Employee profile must be ACTIVE.');
      if (!write) {
        const {rows:accounts}=await client.query("SELECT id FROM users WHERE employee_id=$1 AND status='ACTIVE' FOR SHARE",[employeeId]);
        if(!accounts[0])throw new AppError(409,'Employee account must be ACTIVE to view education.');
      }
      const result = await work(new EducationRepository(client), employees[0]);
      await client.query('COMMIT'); return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23503') throw new AppError(409, 'Employee data changed; reload and try again.');
      throw error;
    } finally { client.release(); }
  }
  async listAllForHr(actorId) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const {rows:users}=await client.query(`SELECT u.status,r.name AS role FROM users u JOIN role r ON r.id=u.role_id WHERE u.id=$1 FOR SHARE OF u`,[actorId]);
      if(users[0]?.status!=='ACTIVE'||users[0]?.role!=='HR') throw new AppError(403,'Only ACTIVE HR can view employee education.');
      const {rows}=await client.query(`SELECT education.*, e.employee_code AS "employeeCode", e.full_name AS "fullName"
        FROM (SELECT ${columns} FROM public.employee_educations WHERE status='ACTIVE') education
        JOIN employees e ON e.id=education."employeeId"
        WHERE e.employment_status = 'ACTIVE'
          AND EXISTS (SELECT 1 FROM users account WHERE account.employee_id=e.id AND account.status='ACTIVE')
        ORDER BY education."employeeId" ASC, education."graduationYear" DESC NULLS LAST, education.id DESC`);
      await client.query('COMMIT'); return rows;
    } catch(error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async activeEmployees() {
    const {rows}=await this.pool.query(`SELECT e.id,e.employee_code AS "employeeCode",e.full_name AS "fullName",
      to_char(e.date_of_birth,'YYYY-MM-DD') AS "dateOfBirth",e.employment_status AS "employmentStatus"
      FROM employees e WHERE e.employment_status='ACTIVE'
      AND EXISTS (SELECT 1 FROM users u WHERE u.employee_id=e.id AND u.status='ACTIVE') ORDER BY e.id`);
    return rows;
  }
  async assertHr(actorId) {
    const {rows}=await this.pool.query('SELECT u.status,r.name AS role FROM users u JOIN role r ON r.id=u.role_id WHERE u.id=$1',[actorId]);
    if(rows[0]?.status!=='ACTIVE'||rows[0]?.role!=='HR')throw new AppError(403,'Only ACTIVE HR can search institutions.');
  }
  async findById(employeeId,id) {
    const {rows}=await this.pool.query(`SELECT ${columns} FROM public.employee_educations WHERE employee_id=$1 AND id=$2 AND status='ACTIVE' FOR UPDATE`,[employeeId,id]);
    return rows[0]||null;
  }
  async list(employeeId) {
    return (await this.pool.query(`SELECT ${columns} FROM public.employee_educations WHERE employee_id=$1 AND status='ACTIVE' ORDER BY graduation_year DESC NULLS LAST, id DESC`, [employeeId])).rows;
  }
  async create(employeeId, data) {
    return (await this.pool.query(`INSERT INTO public.employee_educations
      (employee_id,education_level,field_of_study,institution,graduation_year)
      VALUES ($1,$2,$3,$4,$5) RETURNING ${columns}`, [employeeId,data.educationLevel,data.fieldOfStudy,data.institution,data.graduationYear])).rows[0];
  }
  async update(employeeId, id, data) {
    const fields = {educationLevel:'education_level',fieldOfStudy:'field_of_study',institution:'institution',graduationYear:'graduation_year'};
    const values = [employeeId,id];
    const assignments = Object.entries(data).map(([field,value]) => { values.push(value); return fields[field]+'=$'+values.length; });
    return (await this.pool.query(`UPDATE public.employee_educations SET ${assignments.join(', ')}, updated_at=CURRENT_TIMESTAMP
      WHERE employee_id=$1 AND id=$2 AND status='ACTIVE' RETURNING ${columns}`, values)).rows[0] || null;
  }
  async delete(employeeId, id) {
    return (await this.pool.query(`UPDATE public.employee_educations SET status='INACTIVE', updated_at=CURRENT_TIMESTAMP
      WHERE employee_id=$1 AND id=$2 AND status='ACTIVE' RETURNING ${columns}`, [employeeId,id])).rows[0] || null;
  }
}
module.exports = { EducationRepository };
