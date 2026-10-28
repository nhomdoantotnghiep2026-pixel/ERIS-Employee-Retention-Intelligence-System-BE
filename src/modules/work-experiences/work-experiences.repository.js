const { AppError } = require('../../common/errors/app-error');
const columns = `id, employee_id AS "employeeId", company_name AS "companyName", position_title AS "positionTitle",
  to_char(start_date, 'YYYY-MM-DD') AS "startDate", to_char(end_date, 'YYYY-MM-DD') AS "endDate",
  status, created_at AS "createdAt", updated_at AS "updatedAt"`;

class WorkExperiencesRepository {
  constructor(pool) { this.pool = pool; }
  async withHr(actorId, employeeId, write, work) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: actors } = await client.query(`SELECT u.status, u.employee_id AS "employeeId", r.name AS role
        FROM users u JOIN role r ON r.id=u.role_id WHERE u.id=$1 FOR SHARE OF u`, [actorId]);
      const actor = actors[0];
      if (actor?.status !== 'ACTIVE' || actor.role !== 'HR') throw new AppError(403, 'Chỉ HR ACTIVE được quản lý kinh nghiệm làm việc.');
      let employee;
      if (employeeId !== undefined) {
        if (write && Number(actor.employeeId) === employeeId) throw new AppError(403, 'HR khác phải thêm hoặc xóa kinh nghiệm của bạn.');
        const { rows } = await client.query(`SELECT id, employee_code AS "employeeCode", full_name AS "fullName", employment_status AS "employmentStatus", to_char(date_of_birth, 'YYYY-MM-DD') AS "dateOfBirth"
          FROM employees WHERE id=$1 FOR SHARE`, [employeeId]);
        employee = rows[0];
        if (!employee) throw new AppError(404, 'Không tìm thấy nhân viên.');
        if (employee.employmentStatus !== 'ACTIVE') throw new AppError(409, 'Hồ sơ nhân viên phải ACTIVE.');
        if (!write) {
          const { rows: accounts } = await client.query("SELECT id FROM users WHERE employee_id=$1 AND status='ACTIVE' FOR SHARE", [employeeId]);
          if (!accounts[0]) throw new AppError(409, 'Tài khoản nhân viên phải ACTIVE để xem kinh nghiệm.');
        }
      }
      const result = await work(new WorkExperiencesRepository(client), employee);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async create(employeeId, data, status = 'ACTIVE') {
    if (!['ACTIVE', 'IN_PROCESS'].includes(status)) throw new AppError(400, 'Invalid initial work experience status.');
    const { rows } = await this.pool.query(`INSERT INTO public.employee_work_experiences
      (employee_id, company_name, position_title, start_date, end_date, status)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${columns}`,
    [employeeId, data.companyName, data.positionTitle, data.startDate, data.endDate, status]);
    return rows[0];
  }
  async list(employeeId, includeInProcess = false) {
    return (await this.pool.query(`SELECT ${columns} FROM public.employee_work_experiences
      WHERE employee_id=$1 AND status = ANY($2::varchar[]) ORDER BY start_date DESC NULLS LAST, id DESC`, [employeeId, includeInProcess ? ['ACTIVE', 'IN_PROCESS'] : ['ACTIVE']])).rows;
  }
  async listAll() {
    return (await this.pool.query(`SELECT experience.*, e.employee_code AS "employeeCode", e.full_name AS "fullName"
      FROM (SELECT ${columns} FROM public.employee_work_experiences WHERE status='ACTIVE') experience
      JOIN employees e ON e.id=experience."employeeId"
      WHERE e.employment_status='ACTIVE'
      AND EXISTS (SELECT 1 FROM users u WHERE u.employee_id=e.id AND u.status='ACTIVE')
      ORDER BY experience."employeeId", experience."startDate" DESC NULLS LAST, experience.id DESC`)).rows;
  }
  async deactivate(employeeId, experienceId) {
    return (await this.pool.query(`UPDATE public.employee_work_experiences SET status='INACTIVE', updated_at=CURRENT_TIMESTAMP
      WHERE employee_id=$1 AND id=$2 AND status='ACTIVE' RETURNING ${columns}`, [employeeId, experienceId])).rows[0] || null;
  }
}
module.exports = { WorkExperiencesRepository };
