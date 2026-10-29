class UsersRepository {
  constructor(databasePool) {
    this.databasePool = databasePool;
  }

  async findReadActorById(userId) {
    const { rows } = await this.databasePool.query(
      "SELECT u.id, u.status, r.name AS role FROM users u JOIN role r ON r.id=u.role_id WHERE u.id=$1 LIMIT 1", [userId]);
    return rows[0] || null;
  }

  async listAccounts() {
    const { rows } = await this.databasePool.query(
      `SELECT to_jsonb(account) AS data FROM (
         SELECT u.id, u.email, u.full_name AS "fullName",
           jsonb_build_object('id', r.id, 'name', r.name) AS role,
           u.status, u.employee_id AS "employeeId", u.created_at AS "createdAt", u.updated_at AS "updatedAt"
         FROM users u LEFT JOIN role r ON r.id=u.role_id
       ) account ORDER BY account.id ASC`);
    return rows.map(row => row.data);
  }
  async findAccountById(userId) {
    const { rows } = await this.databasePool.query(
      `SELECT to_jsonb(account) AS data FROM (
         SELECT u.id, u.email, u.full_name AS "fullName",
           jsonb_build_object('id', r.id, 'name', r.name) AS role,
           u.status, u.employee_id AS "employeeId", u.created_at AS "createdAt", u.updated_at AS "updatedAt"
         FROM users u LEFT JOIN role r ON r.id=u.role_id WHERE u.id=$1 LIMIT 1
       ) account`, [userId]);
    return rows[0]?.data || null;
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
