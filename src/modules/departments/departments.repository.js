const { auditMutation, transaction } = require('../audit_logs/audit.repository');
class DepartmentsRepository {
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

  async findAll() {
    const { rows } = await this.databasePool.query(
      `SELECT id, code, name, description, status
       FROM departments
       ORDER BY id ASC`
    );

    return rows;
  }

  async create(data, actorId) {
    return transaction(this.databasePool, client => auditMutation(client,
      { actorId, table: 'departments', id: null, action: 'CREATE' },
      () => new DepartmentsRepository(client)._create(data)));
  }
  async _create({ name, description }) {
    const { rows } = await this.databasePool.query(
      `WITH new_department_id AS (
         SELECT nextval(pg_get_serial_sequence('departments', 'id')) AS id
       )
       INSERT INTO departments (id, code, name, description)
       SELECT
         id,
         'DP' || LPAD(id::text, 3, '0'),
         $1,
         $2
       FROM new_department_id
       RETURNING
         id,
         code,
         name,
         description,
         status,
         created_at AS "createdAt",
         updated_at AS "updatedAt"`,
      [name, description]
    );

    return rows[0];
  }

  async findById(id) {
    const { rows } = await this.databasePool.query(
      `SELECT id, code, name, description, status
       FROM departments
       WHERE id = $1
       LIMIT 1`,
      [id]
    );

    return rows[0] || null;
  }

  async hasActiveEmployees(departmentId) {
    const { rows } = await this.databasePool.query(
      `SELECT EXISTS (
         SELECT 1
         FROM employees
         WHERE department_id = $1
           AND employment_status = 'ACTIVE'
       ) AS "hasActiveEmployees"`,
      [departmentId]
    );

    return rows[0].hasActiveEmployees;
  }

  async deactivate(id, actorId) {
    return transaction(this.databasePool, client => auditMutation(client,
      { actorId, table: 'departments', id: id, action: 'SOFT_DELETE' },
      () => new DepartmentsRepository(client)._deactivate(id)));
  }
  async _deactivate(id) {
    const { rows } = await this.databasePool.query(
      `UPDATE departments
       SET status = 'INACTIVE',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING
         id,
         code,
         name,
         description,
         status,
         updated_at AS "updatedAt"`,
      [id]
    );

    return rows[0] || null;
  }

  async update(id, data, actorId) {
    return transaction(this.databasePool, client => auditMutation(client,
      { actorId, table: 'departments', id: id, action: 'UPDATE' },
      () => new DepartmentsRepository(client)._update(id, data)));
  }
  async _update(id, department) {
    const assignments = [];
    const values = [];

    if (Object.hasOwn(department, 'name')) {
      values.push(department.name);
      assignments.push(`name = $${values.length}`);
    }

    if (Object.hasOwn(department, 'description')) {
      values.push(department.description);
      assignments.push(`description = $${values.length}`);
    }

    values.push(id);
    const { rows } = await this.databasePool.query(
      `UPDATE departments
       SET ${assignments.join(', ')},
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $${values.length}
       RETURNING
         id,
         code,
         name,
         description,
         status,
         updated_at AS "updatedAt"`,
      values
    );

    return rows[0] || null;
  }
}

module.exports = { DepartmentsRepository };
