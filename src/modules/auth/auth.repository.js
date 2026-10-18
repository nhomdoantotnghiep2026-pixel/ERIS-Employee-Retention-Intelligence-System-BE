class AuthRepository {
  constructor(databasePool) {
    this.databasePool = databasePool;
  }

  async findUserByEmail(email) {
    const { rows } = await this.databasePool.query(
      `SELECT
        users.id,
        users.email,
        users.password_hash AS password,
        users.status,
        users.role_id AS "roleId",
        role.name AS "roleName",
        COALESCE(users.full_name, employees.full_name) AS "fullName"
      FROM users
      INNER JOIN role ON role.id = users.role_id
      LEFT JOIN employees ON employees.id = users.employee_id
      WHERE LOWER(users.email) = LOWER($1)
      LIMIT 1`,
      [email]
    );

    return rows[0] || null;
  }

  async findCurrentUserById(userId) {
    const { rows } = await this.databasePool.query(
      `SELECT
        users.id,
        users.email,
        users.status,
        role.name AS role,
        COALESCE(users.full_name, employees.full_name) AS "fullName"
      FROM users
      INNER JOIN role ON role.id = users.role_id
      LEFT JOIN employees ON employees.id = users.employee_id
      WHERE users.id = $1
      LIMIT 1`,
      [userId]
    );

    return rows[0] || null;
  }

  async findUserById(userId) {
    const { rows } = await this.databasePool.query(
      `SELECT id, email, status
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [userId]
    );

    return rows[0] || null;
  }

  async findUserForTokenById(userId) {
    const { rows } = await this.databasePool.query(
      `SELECT
        users.id,
        users.email,
        users.status,
        users.role_id AS "roleId"
      FROM users
      WHERE users.id = $1
      LIMIT 1`,
      [userId]
    );

    return rows[0] || null;
  }

  async findUserCredentialsById(userId) {
    const { rows } = await this.databasePool.query(
      `SELECT id, password_hash AS password, status
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [userId]
    );

    return rows[0] || null;
  }

  async updatePassword(userId, passwordHash, status) {
    const { rows } = await this.databasePool.query(
      `UPDATE users
       SET password_hash = $2,
           status = $3
       WHERE id = $1
       RETURNING id`,
      [userId, passwordHash, status]
    );

    return rows[0] || null;
  }
}

module.exports = { AuthRepository };
