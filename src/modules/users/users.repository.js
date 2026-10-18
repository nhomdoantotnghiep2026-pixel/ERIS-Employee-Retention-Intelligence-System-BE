class UsersRepository {
  constructor(databasePool) {
    this.databasePool = databasePool;
  }

  async findUserRoleById(userId) {
    const { rows } = await this.databasePool.query(
      `SELECT users.id, role.name AS role
       FROM users
       INNER JOIN role ON role.id = users.role_id
       WHERE users.id = $1
       LIMIT 1`,
      [userId]
    );

    return rows[0] || null;
  }

  async findUserById(userId) {
    const { rows } = await this.databasePool.query(
      `SELECT users.id, role.name AS role
       FROM users
       INNER JOIN role ON role.id = users.role_id
       WHERE users.id = $1
       LIMIT 1`,
      [userId]
    );

    return rows[0] || null;
  }

  async updateHrStatus(userId, status) {
    const { rows } = await this.databasePool.query(
      `UPDATE users
       SET status = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE users.id = $1
         AND users.role_id = (SELECT id FROM role WHERE name = 'HR')
       RETURNING users.id,
                 users.email,
                 users.full_name AS "fullName",
                 users.status,
                 users.created_at AS "createdAt"`,
      [userId, status]
    );

    return rows[0] || null;
  }
}

module.exports = { UsersRepository };
