const { auditMutation, transaction } = require('../audit_logs/audit.repository');
const { AppError } = require('../../common/errors/app-error');
class PositionsRepository {
  constructor(databasePool) {
    this.databasePool = databasePool;
  }

  async findUserRoleById(userId) {
    const { rows } = await this.databasePool.query(
      `SELECT role.name AS role
       FROM users
       INNER JOIN role ON role.id = users.role_id
       WHERE users.id = $1
       LIMIT 1`,
      [userId]
    );

    return rows[0] || null;
  }

  async findAll(departmentId = null) {
    const { rows } = await this.databasePool.query(
      `SELECT
         id,
         code,
         name,
         job_level AS "jobLevel",
         department_id AS "departmentId",
         description,
         status
       FROM positions
       WHERE ($1::integer IS NULL OR department_id=$1)
       ORDER BY id ASC`,
      [departmentId]
    );

    return rows;
  }

  async findById(id) {
    const { rows } = await this.databasePool.query(
      `SELECT
         id,
         code,
         name,
         job_level AS "jobLevel",
         department_id AS "departmentId",
         description,
         status,
         created_at AS "createdAt",
         updated_at AS "updatedAt"
       FROM positions
       WHERE id = $1
       LIMIT 1`,
      [id]
    );

    return rows[0] || null;
  }

  async create(data, actorId) {
    return transaction(this.databasePool, client => auditMutation(client,
      { actorId, table: 'positions', id: null, action: 'CREATE' },
      () => new PositionsRepository(client)._create(data)));
  }
  async _create({ name, jobLevel, departmentId, description }) {
    // Lock the referenced department until creation and its audit log commit.
    const department = await this.databasePool.query('SELECT id FROM departments WHERE id = $1 FOR KEY SHARE', [departmentId]);
    if (!department.rows[0]) throw new AppError(404, 'Department not found.');
    const { rows } = await this.databasePool.query(
      `WITH new_position_id AS (
         SELECT nextval(pg_get_serial_sequence('positions', 'id')) AS id
       )
       INSERT INTO positions (id, code, name, job_level, description, department_id)
       SELECT
         id,
         'POS' || LPAD(id::text, 3, '0'),
         $1,
         $2,
         $3,
         $4
       FROM new_position_id
       RETURNING
         id,
         code,
         name,
         job_level AS "jobLevel",
         department_id AS "departmentId",
         description,
         status,
         created_at AS "createdAt",
         updated_at AS "updatedAt"`,
      [name, jobLevel, description, departmentId]
    );

    return rows[0];
  }

  async update(id, data, actorId) {
    return transaction(this.databasePool, client => auditMutation(client,
      { actorId, table: 'positions', id: id, action: 'UPDATE' },
      () => new PositionsRepository(client)._update(id, data)));
  }
  async _update(id, position) {
    const assignments = [];
    const values = [];

    if (Object.hasOwn(position, 'name')) {
      values.push(position.name);
      assignments.push(`name = $${values.length}`);
    }

    if (Object.hasOwn(position, 'jobLevel')) {
      values.push(position.jobLevel);
      assignments.push(`job_level = $${values.length}`);
    }

    if (Object.hasOwn(position, 'description')) {
      values.push(position.description);
      assignments.push(`description = $${values.length}`);
    }

    values.push(id);
    const { rows } = await this.databasePool.query(
      `UPDATE positions
       SET ${assignments.join(', ')},
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $${values.length}
       RETURNING
         id,
         code,
         name,
         job_level AS "jobLevel",
         description,
         status,
         updated_at AS "updatedAt"`,
      values
    );

    return rows[0] || null;
  }

  async hasNonInactiveEmployees(positionId) {
    const { rows } = await this.databasePool.query(
      `SELECT EXISTS (
         SELECT 1
         FROM employees
         WHERE position_id = $1
           AND employment_status <> 'INACTIVE'
       ) AS "hasNonInactiveEmployees"`,
      [positionId]
    );

    return rows[0].hasNonInactiveEmployees;
  }

  async deactivate(id, actorId) {
    return transaction(this.databasePool, client => auditMutation(client,
      { actorId, table: 'positions', id: id, action: 'SOFT_DELETE' },
      () => new PositionsRepository(client)._deactivate(id)));
  }
  async _deactivate(id) {
    if (await this.hasNonInactiveEmployees(id)) {
      throw new AppError(409, 'Cannot deactivate a position while employees with employment_status other than INACTIVE are assigned to it.');
    }
    const { rows } = await this.databasePool.query(
      `UPDATE positions
       SET status = 'INACTIVE',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING
         id,
         code,
         name,
         job_level AS "jobLevel",
         status,
         updated_at AS "updatedAt"`,
      [id]
    );

    return rows[0] || null;
  }
}

module.exports = { PositionsRepository };
