const { AppError } = require('../../common/errors/app-error');
const allowedChangeTypes = new Set(['HIRE', 'PROMOTION', 'ROLE_CHANGE']);

const historyColumns = `h.id, h.employee_id AS "employeeId", h.department_id AS "departmentId",
  h.position_id AS "positionId", h.manager_id AS "managerId", h.change_type AS "changeType",
  to_char(h.start_date, 'YYYY-MM-DD') AS "startDate",
  to_char(h.end_date, 'YYYY-MM-DD') AS "endDate", h.created_at AS "createdAt"`;

class JobHistoriesRepository {
  constructor(pool) { this.pool = pool; }

  async transaction(work) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(new JobHistoriesRepository(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23503') throw new AppError(409, 'Nhân viên, phòng ban hoặc vị trí đã thay đổi. Hãy tải lại dữ liệu.');
      if (error.code === '23514') throw new AppError(400, 'Khoảng thời gian lịch sử không hợp lệ.');
      throw error;
    } finally { client.release(); }
  }

  async actor(actorId) {
    const { rows } = await this.pool.query(`SELECT u.id, u.status, u.employee_id AS "employeeId", r.name AS role
      FROM users u JOIN role r ON r.id=u.role_id WHERE u.id=$1 FOR SHARE OF u`, [actorId]);
    return rows[0] || null;
  }

  async employee(employeeId, lock = false) {
    const { rows } = await this.pool.query(`SELECT e.id, e.employment_status AS "status",
      e.department_id AS "departmentId", e.position_id AS "positionId",
      to_char(e.hire_date,'YYYY-MM-DD') AS "hireDate",
      p.name AS "positionName", p.job_level AS "jobLevel"
      FROM employees e LEFT JOIN positions p ON p.id=e.position_id WHERE e.id=$1 ${lock ? 'FOR UPDATE OF e' : 'FOR SHARE OF e'}`, [employeeId]);
    return rows[0] || null;
  }

  async targetDepartment(id) {
    const { rows } = await this.pool.query('SELECT id,status FROM departments WHERE id=$1 FOR SHARE', [id]);
    return rows[0] || null;
  }

  async targetPosition(id) {
    const { rows } = await this.pool.query('SELECT id,name,job_level AS "jobLevel",status FROM positions WHERE id=$1 FOR SHARE', [id]);
    return rows[0] || null;
  }

  async latest(employeeId) {
    const { rows } = await this.pool.query(`SELECT ${historyColumns} FROM public.employee_job_histories h
      WHERE h.employee_id=$1 ORDER BY h.start_date DESC,h.id DESC LIMIT 1 FOR UPDATE OF h`, [employeeId]);
    return rows[0] || null;
  }

  async hasOverlap(employeeId, startDate, endDate) {
    const { rows } = await this.pool.query(`SELECT EXISTS (
      SELECT 1 FROM public.employee_job_histories
      WHERE employee_id=$1 AND start_date <= COALESCE($3::date,'infinity'::date)
        AND COALESCE(end_date,'infinity'::date) >= $2::date
    ) AS overlap`, [employeeId, startDate, endDate]);
    return rows[0].overlap;
  }

  async closeCurrent(id, endDate) {
    const { rows } = await this.pool.query(`UPDATE public.employee_job_histories h SET end_date=$2::date
      WHERE h.id=$1 AND h.end_date IS NULL RETURNING ${historyColumns}`, [id, endDate]);
    return rows[0] || null;
  }

  async insert(employeeId, data, changeType) {
    if (!allowedChangeTypes.has(changeType)) {
      throw new AppError(400, 'changeType phải là HIRE, PROMOTION hoặc ROLE_CHANGE.');
    }
    const { rows } = await this.pool.query(`WITH new_id AS (
      SELECT nextval(pg_get_serial_sequence('public.employee_job_histories','id')) AS id
    ) INSERT INTO public.employee_job_histories
      (id,employee_id,department_id,position_id,manager_id,change_type,start_date,end_date)
      SELECT id,$1,$2,$3,NULL,$4,$5::date,$6::date FROM new_id
      RETURNING id,employee_id AS "employeeId",department_id AS "departmentId",
        position_id AS "positionId",manager_id AS "managerId",change_type AS "changeType",
        to_char(start_date,'YYYY-MM-DD') AS "startDate",
        to_char(end_date,'YYYY-MM-DD') AS "endDate",created_at AS "createdAt"`,
      [employeeId, data.departmentId, data.positionId, changeType, data.startDate, data.endDate]);
    return rows[0];
  }

  async list(employeeId) {
    const { rows } = await this.pool.query(`SELECT ${historyColumns},
      d.name AS "departmentName",p.name AS "positionName",p.job_level AS "jobLevel"
      FROM public.employee_job_histories h
      LEFT JOIN departments d ON d.id=h.department_id
      LEFT JOIN positions p ON p.id=h.position_id
      WHERE h.employee_id=$1 ORDER BY h.start_date DESC,h.id DESC`, [employeeId]);
    return rows;
  }

  async listAll() {
    const { rows } = await this.pool.query(`SELECT ${historyColumns},
      e.employee_code AS "employeeCode", e.full_name AS "employeeName",
      d.name AS "departmentName", p.name AS "positionName", p.job_level AS "jobLevel"
      FROM public.employee_job_histories h
      JOIN employees e ON e.id = h.employee_id
      LEFT JOIN departments d ON d.id = h.department_id
      LEFT JOIN positions p ON p.id = h.position_id
      ORDER BY h.start_date DESC, h.id DESC`);
    return rows;
  }
}

module.exports = { JobHistoriesRepository };
