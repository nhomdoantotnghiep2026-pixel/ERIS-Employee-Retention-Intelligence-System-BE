const { ScheduleDefaults } = require('./work-schedules-defaults');
const { AppError } = require('../../common/errors/app-error');
const { transaction, writeAudit, recordChange } = require('../audit_logs/audit.repository');
class WorkSchedulesRepository {
  constructor(pool,options={}) { this.pool = pool; this.defaults=new ScheduleDefaults(pool,options); this.defaultStore=options.defaultStore; }
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
      await this.defaults.lock(client);
      // Lock the schedule before inspecting history, including concurrent FK assignments.
      const found = await client.query(
        `SELECT id, name, start_time, end_time, break_start, break_end, working_days, is_default, status
         FROM work_schedules WHERE id = $1 FOR UPDATE`, [id]);
      const existing = found.rows[0];
      if (!existing) throw new AppError(404, 'Work schedule not found.');
      const history = await client.query(
        'SELECT EXISTS (SELECT 1 FROM employee_schedule_assignments WHERE schedule_id = $1) AS assigned', [id]);
      const pending=await this.defaults.pending(client);
      const patch = prepareUpdate(existing, history.rows[0].assigned || pending?.scheduleId===id);
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
  async setDefault(id,actorId) { return this.defaults.plan(id,actorId); }
  async createDefault(schedule,actorId) { return this.defaults.plan(null,actorId,schedule); }
  async createIndividual(schedule,employeeId,dates,actorId) { return this.defaults.createIndividual(schedule,employeeId,dates,actorId); }
  async syncDefaults(employeeId=null) { return this.defaults.sync(employeeId); }
  async pendingDefault() { return this.defaults.pending(); }

  async assign(employeeId, assignment, actorId) {
    return transaction(this.pool, async client => {
      await this.defaults.lock(client);
      // SHARE prevents editing/deactivating the schedule until this assignment commits.
      const schedule = await client.query('SELECT id, status FROM work_schedules WHERE id = $1 FOR SHARE', [assignment.schedule_id]);
      if (!schedule.rows[0]) throw new AppError(404, 'Work schedule not found.');
      if (schedule.rows[0].status !== 'ACTIVE') throw new AppError(409, 'Cannot assign an inactive work schedule.');
      // Serialize assignment requests for this employee, even across different schedules.
      const employee = await client.query('SELECT id FROM employees WHERE id = $1 FOR UPDATE', [employeeId]);
      if (!employee.rows[0]) throw new AppError(404, 'Employee not found.');
      if(this.defaultStore)await this.defaults.prepareIndividual(client,employeeId,{...assignment,actorId});
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
  async removeAssignment(employeeId,assignmentId,actorId) {
    return transaction(this.pool,async client=>{
      await this.defaults.lock(client);
      // Serialize with assigning a schedule and attendance's employee row lock.
      const employee=await client.query('SELECT id FROM employees WHERE id=$1 FOR UPDATE',[employeeId]);
      if(!employee.rows[0])throw new AppError(404,'Employee not found.');
      const found=await client.query(`SELECT id,employee_id,schedule_id,
        effective_from::text,effective_to::text FROM employee_schedule_assignments
        WHERE id=$1 AND employee_id=$2 FOR UPDATE`,[assignmentId,employeeId]);
      const assignment=found.rows[0];
      if(!assignment)throw new AppError(404,'Schedule assignment not found for this employee.');
      if(this.defaultStore){
        const current=await this.defaults.current(client),pending=await this.defaults.pending(client);
        if([current?.id,pending?.scheduleId].includes(assignment.schedule_id))throw new AppError(409,'Đây là dòng gán mặc định, không phải lịch riêng để xóa. Hãy gán lịch riêng thay thế.');
      }
      const {rows:dates}=await client.query("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS today");
      if(assignment.effective_from<dates[0].today)throw new AppError(409,'Không thể xóa lần gán đã bắt đầu trước hôm nay. Cần giữ lịch sử áp dụng.');
      const used=await client.query(`SELECT id FROM attendance WHERE employee_id=$1
        AND work_date>=$2::date AND ($3::date IS NULL OR work_date<=$3::date) LIMIT 1`,
        [employeeId,assignment.effective_from,assignment.effective_to]);
      if(used.rows.length)throw new AppError(409,'Không thể xóa: khoảng gán đã có bản ghi chấm công.');
      await client.query('DELETE FROM employee_schedule_assignments WHERE id=$1 AND employee_id=$2',[assignmentId,employeeId]);
      await writeAudit(client,{actorId,entityType:'employee_schedule_assignments',entityId:assignmentId,
        action:'DELETE',oldValue:assignment});
      return assignment;
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
