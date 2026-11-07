const { AppError } = require('../../common/errors/app-error');
const { transaction, writeAudit, recordChange } = require('../audit_logs/audit.repository');
class WorkSchedulesRepository {
  constructor(pool) { this.pool = pool; }
  async findActor(id) {
    const { rows } = await this.pool.query(`SELECT role.name AS role, users.status FROM users JOIN role ON role.id = users.role_id WHERE users.id = $1`, [id]);
    return rows[0] || null;
  }
  async findAssignments(employeeId) {
    const employee = await this.pool.query('SELECT id FROM employees WHERE id = $1', [employeeId]);
    if (!employee.rows[0]) throw new AppError(404, 'Employee not found.');
    const { rows } = await this.pool.query(
      `SELECT a.id, a.employee_id, a.schedule_id,
              a.effective_from::text AS effective_from, a.effective_to::text AS effective_to,
              s.name, s.start_time, s.end_time, s.break_start, s.break_end, s.working_days, s.status
       FROM employee_schedule_assignments a
       JOIN work_schedules s ON s.id = a.schedule_id
       WHERE a.employee_id = $1
       ORDER BY a.effective_from DESC, a.id DESC`, [employeeId]);
    return rows;
  }
  async findAll() {
    const { rows } = await this.pool.query(
      `SELECT id, name, start_time, end_time, break_start, break_end, working_days, is_default, status
       FROM work_schedules ORDER BY id ASC`);
    return rows;
  }
  async update(id, actorId, prepareUpdate) {
    return transaction(this.pool, async client => {
      // Lock the schedule before inspecting history, including concurrent FK assignments.
      const found = await client.query(
        `SELECT id, name, start_time, end_time, break_start, break_end, working_days, is_default, status
         FROM work_schedules WHERE id = $1 FOR UPDATE`, [id]);
      const existing = found.rows[0];
      if (!existing) throw new AppError(404, 'Work schedule not found.');
      const history = await client.query(
        'SELECT EXISTS (SELECT 1 FROM employee_schedule_assignments WHERE schedule_id = $1) AS assigned', [id]);
      const patch = prepareUpdate(existing, history.rows[0].assigned);
      const keys = Object.keys(patch);
      // Column identifiers come exclusively from the validated whitelist.
      const values = keys.map(key => patch[key]);
      values.push(id);
      const { rows } = await client.query(
        `UPDATE work_schedules SET ${keys.map((key, index) => `${key} = $${index + 1}`).join(', ')}
         WHERE id = $${values.length}
         RETURNING id, name, start_time, end_time, break_start, break_end, working_days, is_default, status`, values);
      await recordChange(client, actorId, 'work_schedules', id, 'UPDATE', existing, rows[0]);
      return rows[0];
    });
  }
  async setDefault(id, actorId) {
    return transaction(this.pool, async client => {
      // Serialize default changes, including when no default exists yet.
      await client.query('SELECT pg_advisory_xact_lock(74123, 1)');
      const { rows } = await client.query(
        'SELECT * FROM work_schedules WHERE id = $1 OR is_default = TRUE ORDER BY id FOR UPDATE', [id]);
      const selected = rows.find(row => row.id === id);
      if (!selected) throw new AppError(404, 'Work schedule not found.');
      if (selected.status !== 'ACTIVE') throw new AppError(409, 'An inactive schedule cannot be the default.');
      if (selected.is_default) return selected;
      const previous = rows.find(row => row.is_default);
      if (previous) {
        const cleared = await client.query('UPDATE work_schedules SET is_default = FALSE WHERE id = $1 RETURNING *', [previous.id]);
        await recordChange(client, actorId, 'work_schedules', previous.id, 'UPDATE', previous, cleared.rows[0]);
      }
      const changed = await client.query('UPDATE work_schedules SET is_default = TRUE WHERE id = $1 RETURNING *', [id]);
      await recordChange(client, actorId, 'work_schedules', id, 'UPDATE', selected, changed.rows[0]);
      return changed.rows[0];
    });
  }

  async assign(employeeId, assignment, actorId) {
    return transaction(this.pool, async client => {
      // SHARE prevents editing/deactivating the schedule until this assignment commits.
      const schedule = await client.query('SELECT id, status FROM work_schedules WHERE id = $1 FOR SHARE', [assignment.schedule_id]);
      if (!schedule.rows[0]) throw new AppError(404, 'Work schedule not found.');
      if (schedule.rows[0].status !== 'ACTIVE') throw new AppError(409, 'Cannot assign an inactive work schedule.');
      // Serialize assignment requests for this employee, even across different schedules.
      const employee = await client.query('SELECT id FROM employees WHERE id = $1 FOR UPDATE', [employeeId]);
      if (!employee.rows[0]) throw new AppError(404, 'Employee not found.');
      const overlap = await client.query(
        `SELECT id FROM employee_schedule_assignments
         WHERE employee_id = $1
           AND ($3::date IS NULL OR effective_from <= $3::date)
           AND (effective_to IS NULL OR effective_to >= $2::date)
         LIMIT 1`, [employeeId, assignment.effective_from, assignment.effective_to]);
      if (overlap.rows.length) throw new AppError(409, 'The assignment dates overlap an existing schedule assignment.');
      const { rows } = await client.query(
        `INSERT INTO employee_schedule_assignments (employee_id, schedule_id, effective_from, effective_to)
         VALUES ($1, $2, $3, $4)
         RETURNING id, employee_id, schedule_id, effective_from::text, effective_to::text`,
        [employeeId, assignment.schedule_id, assignment.effective_from, assignment.effective_to]);
      await writeAudit(client, { actorId, entityType: 'employee_schedule_assignments', entityId: rows[0].id, action: 'CREATE', newValue: rows[0] });
      return rows[0];
    });
  }
  async create(schedule, actorId) {
    return transaction(this.pool, async client => {
      const { rows } = await client.query(
        `INSERT INTO work_schedules (name, start_time, end_time, break_start, break_end, working_days, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, name, start_time, end_time, break_start, break_end, working_days, is_default, status`,
        [schedule.name, schedule.start_time, schedule.end_time, schedule.break_start, schedule.break_end, schedule.working_days, schedule.status]);
      await writeAudit(client, { actorId, entityType: 'work_schedules', entityId: rows[0].id, action: 'CREATE', newValue: rows[0] });
      return rows[0];
    });
  }
}
module.exports = { WorkSchedulesRepository };
