const { AppError } = require('../../common/errors/app-error');
const { JobHistoriesRepository } = require('../job-histories/job-histories.repository');
class AuthRepository {
  constructor(databasePool) {
    this.databasePool = databasePool;
  }

  async createHrAccount(actorId, input, passwordHash) {
    const client = await this.databasePool.connect();
    try {
      await client.query('BEGIN');
      const { rows: actors } = await client.query(
        `SELECT role.name AS role, users.status FROM users
         INNER JOIN role ON role.id = users.role_id WHERE users.id = $1 FOR SHARE OF users`, [actorId]);
      if (actors[0]?.role !== 'ADMIN' || actors[0]?.status !== 'ACTIVE') throw new AppError(403, 'Only an ACTIVE ADMIN can create HR accounts.');
      const { rows: roles } = await client.query("SELECT id FROM role WHERE name = 'HR'");
      if (roles.length !== 1) throw new AppError(503, 'HR role is not configured.');
      if (input.roleId !== undefined && input.roleId !== roles[0].id) throw new AppError(400, 'roleId must identify HR; ADMIN and EMPLOYEE accounts cannot be created here.');
      await client.query('SELECT pg_advisory_xact_lock(hashtext(lower($1)))', [input.email]);
      const { rows: checks } = await client.query(
        `SELECT EXISTS (SELECT 1 FROM users WHERE lower(email) = lower($1)
                        UNION ALL SELECT 1 FROM employees WHERE lower(email) = lower($1)) AS exists`, [input.email]);
      if (checks[0].exists) throw new AppError(409, 'Email is already in use.');
      const { rows } = await client.query(
        `INSERT INTO users (email, password_hash, full_name, role_id, status, employee_id)
         VALUES ($1, $2, $3, $4, 'IN_PROCESS', NULL)
         RETURNING id, email, full_name AS "fullName", role_id AS "roleId", status,
                   employee_id AS "employeeId", created_at AS "createdAt"`,
        [input.email, passwordHash, null, roles[0].id]);
      await client.query('COMMIT');
      return { ...rows[0], role: 'HR' };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') throw new AppError(409, 'Email is already in use.');
      throw error;
    } finally { client.release(); }
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
    const client = await this.databasePool.connect();
    try {
      await client.query('BEGIN');
      const { rows: accounts } = await client.query(
        'SELECT id, status, employee_id AS "employeeId" FROM users WHERE id = $1 FOR UPDATE', [userId]);
      const account = accounts[0];
      if (!account) throw new AppError(404, 'Account not found.');
      const activating = account.status === 'IN_PROCESS' && status === 'ACTIVE';
      const { rows } = await client.query(
        `UPDATE users SET password_hash = $2, status = $3 WHERE id = $1 RETURNING id`,
        [userId, passwordHash, status]);
      if (activating && account.employeeId != null) {
        const { rows: profiles } = await client.query(
          `SELECT id, employment_status AS status, department_id AS "departmentId",
                  position_id AS "positionId", to_char(hire_date, 'YYYY-MM-DD') AS "hireDate"
           FROM employees WHERE id = $1 FOR UPDATE`, [account.employeeId]);
        const profile = profiles[0];
        if (!profile || profile.status === 'INACTIVE') {
          throw new AppError(409, 'Employee profile cannot be activated.');
        }
        if (profile.status === 'IN_PROCESS') {
          await client.query(
            `UPDATE employees SET employment_status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [profile.id]);
        }
        const histories = new JobHistoriesRepository(client);
        if (!await histories.latest(profile.id)) {
          await histories.insert(profile.id, {
            departmentId: profile.departmentId,
            positionId: profile.positionId,
            startDate: profile.hireDate,
            endDate: null
          }, 'HIRE');
        }
      }
      await client.query('COMMIT');
      return rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
}

module.exports = { AuthRepository };
