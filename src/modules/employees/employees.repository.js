class EmployeesRepository {
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
      `SELECT id
       FROM employees
       WHERE id = $1
       LIMIT 1`,
      [id]
    );

    return rows[0] || null;
  }

  async update(id, employee) {
    const assignments = [];
    const values = [];
    const fields = [
      ['fullName', 'full_name'],
      ['email', 'email'],
      ['phone', 'phone'],
      ['dateOfBirth', 'date_of_birth'],
      ['gender', 'gender'],
      ['address', 'address'],
      ['distanceFromHomeKm', 'distance_from_home_km'],
      ['departmentId', 'department_id'],
      ['positionId', 'position_id'],
      ['hireDate', 'hire_date'],
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
      `UPDATE employees
       SET ${assignments.join(', ')},
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $${values.length}
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
         updated_at AS "updatedAt"`,
      values
    );

    return rows[0] || null;
  }
}

module.exports = { EmployeesRepository };
