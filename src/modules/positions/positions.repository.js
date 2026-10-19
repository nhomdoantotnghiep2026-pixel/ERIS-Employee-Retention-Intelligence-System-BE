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

  async findAll() {
    const { rows } = await this.databasePool.query(
      `SELECT
         id,
         code,
         name,
         job_level AS "jobLevel",
         description,
         status
       FROM positions
       ORDER BY id ASC`
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
}

module.exports = { PositionsRepository };
