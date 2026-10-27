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

  async create({ name, jobLevel, description }) {
    const { rows } = await this.databasePool.query(
      `WITH new_position_id AS (
         SELECT nextval(pg_get_serial_sequence('positions', 'id')) AS id
       )
       INSERT INTO positions (id, code, name, job_level, description)
       SELECT
         id,
         'POS' || LPAD(id::text, 3, '0'),
         $1,
         $2,
         $3
       FROM new_position_id
       RETURNING
         id,
         code,
         name,
         job_level AS "jobLevel",
         description,
         status,
         created_at AS "createdAt",
         updated_at AS "updatedAt"`,
      [name, jobLevel, description]
    );

    return rows[0];
  }

  async update(id, position) {
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

  async hasActiveEmployees(positionId) {
    const { rows } = await this.databasePool.query(
      `SELECT EXISTS (
         SELECT 1
         FROM employees
         WHERE position_id = $1
           AND employment_status = 'ACTIVE'
       ) AS "hasActiveEmployees"`,
      [positionId]
    );

    return rows[0].hasActiveEmployees;
  }

  async deactivate(id) {
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
