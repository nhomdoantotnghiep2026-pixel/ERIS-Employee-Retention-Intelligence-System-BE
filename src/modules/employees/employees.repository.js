const { AppError } = require('../../common/errors/app-error');
class EmployeesRepository {
  constructor(databasePool) {
    this.databasePool = databasePool;
  }

  async findAccountByEmail(email) {
    const { rows } = await this.databasePool.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1', [email]);
    return rows[0] || null;
  }
  async findLinkedAccount(employeeId) {
    const { rows } = await this.databasePool.query('SELECT id, email FROM users WHERE employee_id = $1 LIMIT 1', [employeeId]);
    return rows[0] || null;
  }
  async createWithAccount(employee, passwordHash) {
    const client = await this.databasePool.connect();
    try {
      await client.query('BEGIN');
      // Serialize this workflow for case-insensitive email checks, including concurrent HR requests.
      await client.query('SELECT pg_advisory_xact_lock(hashtext(lower($1)))', [employee.email]);
      const repository = new EmployeesRepository(client);
      if (await repository.findAccountByEmail(employee.email) || await repository.findByEmail(employee.email)) {
        throw new AppError(409, 'Email is already in use.');
      }
      const { rows: roles } = await client.query("SELECT id FROM role WHERE name = 'EMPLOYEE'");
      if (roles.length !== 1) throw new AppError(503, 'EMPLOYEE role is not configured.');
      const record = await repository.create(employee);
      const { rows } = await client.query(
        `INSERT INTO users (email, password_hash, role_id, status, employee_id, full_name)
         VALUES ($1, $2, $3, 'IN_PROCESS', $4, $5)
         RETURNING id, email, role_id AS "roleId", status, employee_id AS "employeeId"`,
        [employee.email, passwordHash, roles[0].id, record.id, employee.fullName]);
      await client.query('COMMIT');
      return { employee: record, account: { ...rows[0], role: 'EMPLOYEE' } };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') throw new AppError(409, 'Employee or account already exists.');
      throw error;
    } finally { client.release(); }
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

  async findByEmail(email, excludedEmployeeId = null) {
    if (!email) return null;

    const { rows } = await this.databasePool.query(
      `SELECT id
       FROM employees
       WHERE LOWER(email) = LOWER($1)
         AND ($2::integer IS NULL OR id <> $2)
       LIMIT 1`,
      [email, excludedEmployeeId]
    );

    return rows[0] || null;
  }

  async findActiveDepartmentById(id) {
    const { rows } = await this.databasePool.query(
      `SELECT id
       FROM departments
       WHERE id = $1
         AND status = 'ACTIVE'
       LIMIT 1`,
      [id]
    );

    return rows[0] || null;
  }

  async findActivePositionById(id) {
    const { rows } = await this.databasePool.query(
      `SELECT id
       FROM positions
       WHERE id = $1
         AND status = 'ACTIVE'
       LIMIT 1`,
      [id]
    );

    return rows[0] || null;
  }

  async list(query) {
    const values = [], filters = [];
    if (query.search) {
      values.push(query.search);
      filters.push(`(strpos(lower(full_name), lower($${values.length})) > 0 OR strpos(lower(coalesce(email, '')), lower($${values.length})) > 0 OR strpos(lower(employee_code), lower($${values.length})) > 0)`);
    }
    for (const [key, column] of [['departmentId','department_id'],['positionId','position_id'],['employmentStatus','employment_status']]) {
      if (query[key] !== undefined) { values.push(query[key]); filters.push(`${column} = $${values.length}`); }
    }
    const where = filters.length ? ' WHERE ' + filters.join(' AND ') : '';
    const { rows: counts } = await this.databasePool.query('SELECT count(*)::integer AS total FROM employees' + where, values);
    const total = counts[0].total;
    const paginated = query.page !== undefined;
    const paging = paginated ? ` LIMIT ${values.length + 1} OFFSET ${values.length + 2}` : '';
    const { rows } = await this.databasePool.query(
      `SELECT id, employee_code AS "employeeCode", full_name AS "fullName", email, phone,
date_of_birth AS "dateOfBirth", gender, address, distance_from_home_km AS "distanceFromHomeKm",
department_id AS "departmentId", position_id AS "positionId", hire_date AS "hireDate",
employment_type AS "employmentType", employment_status AS "employmentStatus",
current_salary AS "currentSalary", created_at AS "createdAt", updated_at AS "updatedAt" FROM employees${where} ORDER BY id ASC${paging}`,
      paginated ? [...values, query.limit, (query.page - 1) * query.limit] : values);
    return { data: rows, pagination: paginated ? { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } : { page: 1, limit: null, total, totalPages: total ? 1 : 0 } };
  }
  async create(employee) {
    const { rows } = await this.databasePool.query(
      `WITH new_employee_id AS (
         SELECT nextval(pg_get_serial_sequence('employees', 'id')) AS id
       )
       INSERT INTO employees (
         id,
         employee_code,
         full_name,
         email,
         phone,
         date_of_birth,
         gender,
         address,
         distance_from_home_km,
         department_id,
         position_id,
         hire_date,
         employment_type,
         current_salary
       )
       SELECT
         id,
         'EMP' || LPAD(id::text, 3, '0'),
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
       FROM new_employee_id
       RETURNING
         id,
         employee_code AS "employeeCode",
         full_name AS "fullName",
         email,
         phone,
         date_of_birth AS "dateOfBirth",
         gender,
         address,
         distance_from_home_km AS "distanceFromHomeKm",
         department_id AS "departmentId",
         position_id AS "positionId",
         hire_date AS "hireDate",
         employment_type AS "employmentType",
         employment_status AS "employmentStatus",
         current_salary AS "currentSalary",
         created_at AS "createdAt",
         updated_at AS "updatedAt"`,
      [
        employee.fullName,
        employee.email,
        employee.phone,
        employee.dateOfBirth,
        employee.gender,
        employee.address,
        employee.distanceFromHomeKm,
        employee.departmentId,
        employee.positionId,
        employee.hireDate,
        employee.employmentType,
        employee.currentSalary
      ]
    );

    return rows[0];
  }

  async findById(id) {
    const { rows } = await this.databasePool.query(
      `SELECT id, employee_code AS "employeeCode", full_name AS "fullName", email, phone, date_of_birth AS "dateOfBirth", gender, address, distance_from_home_km AS "distanceFromHomeKm", department_id AS "departmentId", position_id AS "positionId", hire_date AS "hireDate", employment_type AS "employmentType", employment_status AS "employmentStatus", current_salary AS "currentSalary", created_at AS "createdAt", updated_at AS "updatedAt" FROM employees WHERE id = $1
       LIMIT 1`,
      [id]
    );

    return rows[0] || null;
  }

  async deactivate(id) {
    const client = await this.databasePool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT id, employment_status FROM employees WHERE id = $1 FOR UPDATE', [id]);
      if (!rows[0]) throw new AppError(404, 'Employee not found.');
      if (rows[0].employment_status === 'INACTIVE') throw new AppError(409, 'Employee is already inactive.');
      const result = await client.query(
        `UPDATE employees SET employment_status = 'INACTIVE', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 RETURNING id, employee_code AS "employeeCode", employment_status AS "employmentStatus", updated_at AS "updatedAt"`, [id]);
      await client.query("UPDATE users SET status = 'INACTIVE', updated_at = CURRENT_TIMESTAMP WHERE employee_id = $1", [id]);
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
  async update(id, employee) {
    const assignments = [];
    const values = [];
    const fields = [
      ['fullName', 'full_name'],
      ['phone', 'phone'],
      ['gender', 'gender'],
      ['address', 'address'],
      ['distanceFromHomeKm', 'distance_from_home_km'],
      ['departmentId', 'department_id'],
      ['positionId', 'position_id'],
      ['employmentType', 'employment_type'],
      ['currentSalary', 'current_salary']
    ];

    for (const [field, column] of fields) {
      if (Object.hasOwn(employee, field)) {
        values.push(employee[field]);
        assignments.push(`${column} = $${values.length}`);
      }
    }

    values.push(id);
    const { rows } = await this.databasePool.query(
      `WITH updated_employee AS (UPDATE employees
       SET ${assignments.join(', ')},
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $${values.length} AND employment_status IS DISTINCT FROM 'INACTIVE'
       RETURNING
         id,
         employee_code AS "employeeCode",
         full_name AS "fullName",
         email,
         phone,
         date_of_birth AS "dateOfBirth",
         gender,
         address,
         distance_from_home_km AS "distanceFromHomeKm",
         department_id AS "departmentId",
         position_id AS "positionId",
         hire_date AS "hireDate",
         employment_type AS "employmentType",
         employment_status AS "employmentStatus",
         current_salary AS "currentSalary",
         updated_at AS "updatedAt"),
       synced_account AS (
         UPDATE users SET full_name = e."fullName", updated_at = CURRENT_TIMESTAMP
         FROM updated_employee e
         WHERE users.employee_id = e.id AND users.full_name IS DISTINCT FROM e."fullName"
         RETURNING users.id
       ) SELECT * FROM updated_employee`,
      values
    );

    return rows[0] || null;
  }
}

module.exports = { EmployeesRepository };
