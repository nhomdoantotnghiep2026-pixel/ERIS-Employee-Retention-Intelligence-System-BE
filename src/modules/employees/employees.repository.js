const { snapshot, writeAudit, recordChange, transaction } = require('../audit_logs/audit.repository');
const { AppError } = require('../../common/errors/app-error');
const { JobHistoriesRepository } = require('../job-histories/job-histories.repository');
const { recordJobChange } = require('../job-histories/job-histories.transition');
const { EmployeeBackgroundRepository } = require('./employee-background.repository');
const { normalizePhone, phoneKey, phoneKeySql } = require('./employee-phone');
class EmployeesRepository {
  constructor(databasePool) {
    this.databasePool = databasePool;
  }

  async withTransaction(work) {
    const client = await this.databasePool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(new EmployeesRepository(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') throw new AppError(409, 'Profile or email already exists.');
      throw error;
    } finally { client.release(); }
  }
  async findHrTarget(id, lock = false) {
    const { rows } = await this.databasePool.query(
      `SELECT u.id, u.email, u.status, u.employee_id AS "employeeId", r.name AS role
       FROM users u JOIN role r ON r.id = u.role_id WHERE u.id = $1` + (lock ? ' FOR UPDATE OF u' : ''), [id]);
    return rows[0] || null;
  }
  async linkHrProfile(userId, employee) {
    const { rows } = await this.databasePool.query(
      `UPDATE users SET employee_id = $2, full_name = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND employee_id IS NULL
       RETURNING id, email, role_id AS "roleId", status, employee_id AS "employeeId"`,
      [userId, employee.id, employee.fullName]);
    if (!rows[0]) throw new AppError(409, 'HR already has a profile.');
    return { ...rows[0], role: 'HR' };
  }
  async preflightCreate(actorId, employee) {
    const { rows } = await this.databasePool.query(
      `SELECT
        (SELECT role.name FROM users INNER JOIN role ON role.id = users.role_id
         WHERE users.id = $1 AND users.status = 'ACTIVE') AS "actorRole",
        EXISTS (SELECT 1 FROM employees WHERE lower(email) = lower($2)) AS "emailExists",
        (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',u.id,'role',r.name,'status',u.status,'employeeId',u.employee_id)), '[]'::jsonb)
         FROM users u JOIN role r ON r.id=u.role_id WHERE lower(u.email)=lower($2)) AS accounts,
        EXISTS (SELECT 1 FROM departments WHERE id = $3 AND status = 'ACTIVE') AS "activeDepartment",
        EXISTS (SELECT 1 FROM positions WHERE id = $4 AND status = 'ACTIVE') AS "activePosition",
        (SELECT department_id FROM positions WHERE id=$4) AS "positionDepartmentId",
        EXISTS (SELECT 1 FROM employees WHERE ${phoneKeySql}=$5) AS "phoneExists"`,
      [actorId, employee.email, employee.departmentId, employee.positionId, phoneKey(employee.phone)]);
    return rows[0];
  }
  async assertPositionDepartment(positionId, departmentId) {
    const { rows } = await this.databasePool.query(`SELECT p.department_id AS "departmentId", p.status AS "positionStatus", d.status AS "departmentStatus"
      FROM positions p JOIN departments d ON d.id=$2 WHERE p.id=$1 FOR SHARE OF p,d`, [positionId, departmentId]);
    const record = rows[0];
    if (!record || record.positionStatus !== 'ACTIVE' || record.departmentStatus !== 'ACTIVE') throw new AppError(404, 'Phòng ban hoặc vị trí không còn ACTIVE.');
    if (Number(record.departmentId) !== Number(departmentId)) throw new AppError(400, 'Vị trí công việc không thuộc phòng ban đã chọn.');
  }
  async findByPhone(phone, excludedEmployeeId = null) {
    const { rows } = await this.databasePool.query(`SELECT id FROM employees
      WHERE ${phoneKeySql}=$1 AND ($2::integer IS NULL OR id<>$2) LIMIT 1`, [phoneKey(phone), excludedEmployeeId]);
    return rows[0] || null;
  }
  async assertPhoneAvailable(phone, excludedEmployeeId = null) {
    await this.databasePool.query("SELECT pg_advisory_xact_lock(hashtextextended('employees.phone:' || $1, 0))", [phoneKey(phone)]);
    if (await this.findByPhone(phone, excludedEmployeeId)) throw new AppError(409, 'Số điện thoại đã được sử dụng trong hồ sơ nhân viên khác.');
  }
  async findAccountByEmail(email) {
    const { rows } = await this.databasePool.query(
      `SELECT u.id, u.email, u.status, u.employee_id AS "employeeId", r.name AS role
       FROM users u JOIN role r ON r.id = u.role_id WHERE lower(u.email) = lower($1) LIMIT 2`, [email]);
    if (rows.length > 1) throw new AppError(409, 'Multiple accounts use this email; resolve the conflict before linking.');
    return rows[0] || null;
  }
  async findLinkedAccount(employeeId) {
    const { rows } = await this.databasePool.query('SELECT id, email FROM users WHERE employee_id = $1 LIMIT 1', [employeeId]);
    return rows[0] || null;
  }
  async createWithAccount(employee, passwordHash, actorId, auditContext = null) {
    const client = await this.databasePool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext(lower($1)))', [employee.email]);
      const repository = new EmployeesRepository(client);
      if (actorId !== undefined) {
        const actor = await repository.findUserRoleById(actorId);
        if (actor?.role !== 'HR') throw new AppError(403, 'Only ACTIVE HR can create employee profiles.');
      }
      if (await repository.findByEmail(employee.email)) throw new AppError(409, 'Email already has an employee profile.');
      const { rows: accounts } = await client.query(
        `SELECT u.id, u.email, u.role_id AS "roleId", u.status, u.employee_id AS "employeeId", r.name AS role
         FROM users u JOIN role r ON r.id=u.role_id WHERE lower(u.email)=lower($1) FOR UPDATE OF u`, [employee.email]);
      if (accounts.length > 1) throw new AppError(409, 'Multiple accounts use this email.');
      const account = accounts[0];
      if (account) {
        if (Number(account.id) === Number(actorId)) throw new AppError(403, 'Another HR must create your profile.');
        if (account.role !== 'HR' || account.employeeId != null || !['ACTIVE','IN_PROCESS'].includes(account.status)) {
          throw new AppError(409, 'Existing account cannot be linked: only HR without an employee profile is supported.');
        }
      }
      if (!await repository.findActiveDepartmentById(employee.departmentId)) throw new AppError(404, 'Active department not found.');
      if (!await repository.findActivePositionById(employee.positionId)) throw new AppError(404, 'Active position not found.');
      await repository.assertPositionDepartment(employee.positionId, employee.departmentId);
      const record = await repository.create(employee, account?.status === 'ACTIVE' ? 'ACTIVE' : 'IN_PROCESS');
      let saved;
      if (account) {
        const result = await client.query(
          `UPDATE users SET employee_id=$2, full_name=$3, updated_at=CURRENT_TIMESTAMP
           WHERE id=$1 AND employee_id IS NULL
           RETURNING id, email, role_id AS "roleId", status, employee_id AS "employeeId"`, [account.id,record.id,employee.fullName]);
        if (!result.rows[0]) throw new AppError(409, 'HR account already has a profile.');
        saved = { ...result.rows[0], role: 'HR' };
      } else {
        if (!passwordHash) throw new AppError(409, 'Account changed during creation; reload and try again.');
        const {rows: roles} = await client.query("SELECT id FROM role WHERE name='EMPLOYEE'");
        if (roles.length !== 1) throw new AppError(503, 'EMPLOYEE role is not configured.');
        const result = await client.query(
          `INSERT INTO users (email,password_hash,role_id,status,employee_id,full_name)
           VALUES ($1,$2,$3,'IN_PROCESS',$4,$5)
           RETURNING id,email,role_id AS "roleId",status,employee_id AS "employeeId"`,
          [employee.email,passwordHash,roles[0].id,record.id,employee.fullName]);
        saved = { ...result.rows[0], role: 'EMPLOYEE' };
      }
      const initialJobHistory = saved.status === 'ACTIVE'
        ? await new JobHistoriesRepository(client).insert(record.id, {
          departmentId: employee.departmentId,
          positionId: employee.positionId,
          startDate: employee.hireDate,
          endDate: null
        }, 'HIRE')
        : null;
      const backgrounds = new EmployeeBackgroundRepository(client);
      const background = await backgrounds.create(record.id, employee, saved.status === 'ACTIVE' ? 'ACTIVE' : 'IN_PROCESS');
      const createdSnapshot = await snapshot(client, 'employees', record.id);
      const { rows: educationRows } = await client.query('SELECT to_jsonb(e) AS data FROM employee_educations e WHERE employee_id=$1 ORDER BY id', [record.id]);
      const { rows: experienceRows } = await client.query('SELECT to_jsonb(e) AS data FROM employee_work_experiences e WHERE employee_id=$1 ORDER BY id', [record.id]);
      await writeAudit(client, { actorId, entityType: 'employees', entityId: record.id, action: 'CREATE',
        newValue: { ...createdSnapshot, educations: educationRows.map(row => row.data), workExperiences: experienceRows.map(row => row.data),
          ...(initialJobHistory ? { initialJobHistory } : {}), _context: auditContext || { source: 'MANUAL' } } });
      await client.query('COMMIT');
      return { employee: { ...record, ...background }, account: saved, accountCreated: !account, initialJobHistory };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') throw new AppError(409, 'Employee or account already exists.');
      throw error;
    } finally { client.release(); }
  }
  async recordImportAudit(actorId, summary) {
    return transaction(this.databasePool, client => writeAudit(client, {
      actorId, entityType: 'employee_imports', action: 'IMPORT', newValue: summary
    }));
  }
  async createBackground(employeeId, employee) {
    return new EmployeeBackgroundRepository(this.databasePool).create(employeeId, employee);
  }
  async findBackground(employeeId, includePending = false) {
    return new EmployeeBackgroundRepository(this.databasePool).find(employeeId, includePending);
  }
  async findUserRoleById(userId) {
    const { rows } = await this.databasePool.query(
      `SELECT role.name AS role, users.status, users.employee_id AS "employeeId"
       FROM users
       INNER JOIN role ON role.id = users.role_id
       WHERE users.id = $1 AND users.status = 'ACTIVE'
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
      `SELECT id, department_id AS "departmentId"
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
  async create(employee, employmentStatus = 'ACTIVE') {
    const phone = normalizePhone(employee.phone);
    await this.assertPhoneAvailable(phone);
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
         current_salary,
         employment_status
       )
       SELECT
         id,
         'EMP' || LPAD(id::text, 3, '0'),
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
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
        phone,
        employee.dateOfBirth,
        employee.gender,
        employee.address,
        employee.distanceFromHomeKm,
        employee.departmentId,
        employee.positionId,
        employee.hireDate,
        employee.employmentType,
        employee.currentSalary,
        employmentStatus
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

  async findOwnProfileByUserId(userId) {
    const { rows } = await this.databasePool.query(
      `SELECT
         employees.id,
         employees.employee_code AS "employeeCode",
         employees.full_name AS "fullName",
         employees.email,
         employees.phone,
         employees.date_of_birth AS "dateOfBirth",
         employees.gender,
         employees.address,
         employees.distance_from_home_km AS "distanceFromHomeKm",
         employees.hire_date AS "hireDate",
         employees.employment_type AS "employmentType",
         employees.employment_status AS "employmentStatus",
         employees.current_salary AS "currentSalary",
         employees.created_at AS "createdAt",
         employees.updated_at AS "updatedAt",
         departments.id AS "departmentId",
         departments.code AS "departmentCode",
         departments.name AS "departmentName",
         positions.id AS "positionId",
         positions.code AS "positionCode",
         positions.name AS "positionName",
         positions.job_level AS "jobLevel"
       FROM users
       INNER JOIN employees ON employees.id = users.employee_id
       LEFT JOIN departments ON departments.id = employees.department_id
       LEFT JOIN positions ON positions.id = employees.position_id
       WHERE users.id = $1
         AND users.status = 'ACTIVE'
       LIMIT 1`,
      [userId]
    );

    return rows[0] || null;
  }

  async deactivate(id, actorId) {
    const client = await this.databasePool.connect();
    try {
      await client.query('BEGIN');
      if (actorId !== undefined) {
        const actor = await new EmployeesRepository(client).findHrTarget(actorId, true);
        if (actor?.role !== 'HR' || actor?.status !== 'ACTIVE') throw new AppError(403, 'Only ACTIVE HR can deactivate profiles.');
        if (Number(actor.employeeId) === Number(id)) throw new AppError(403, 'You cannot deactivate your own profile.');
      }
      const beforeAudit = await snapshot(client, 'employees', id, true);
      const { rows } = await client.query('SELECT id, employment_status FROM employees WHERE id = $1 FOR UPDATE', [id]);
      if (!rows[0]) throw new AppError(404, 'Employee not found.');
      if (rows[0].employment_status === 'INACTIVE') throw new AppError(409, 'Employee is already inactive.');
      const result = await client.query(
        `UPDATE employees SET employment_status = 'INACTIVE', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 RETURNING id, employee_code AS "employeeCode", employment_status AS "employmentStatus", updated_at AS "updatedAt"`, [id]);
      await client.query("UPDATE users SET status = 'INACTIVE', updated_at = CURRENT_TIMESTAMP WHERE employee_id = $1", [id]);
      await recordChange(client, actorId, 'employees', id, 'SOFT_DELETE', beforeAudit, await snapshot(client, 'employees', id));
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
  async updateAuthorized(actorId, id, employee) {
    return this.withTransaction(async repository => {
      const actor = await repository.findHrTarget(actorId, true);
      if (actor?.role !== 'HR' || actor?.status !== 'ACTIVE') throw new AppError(403, 'Only ACTIVE HR can update profiles.');
      if (Number(actor.employeeId) === Number(id) && Object.keys(employee).some(key => !['phone','address','addressRefId','distanceFromHomeKm'].includes(key))) {
        throw new AppError(403, 'You may only update phone and address on your own profile.');
      }
      const histories = new JobHistoriesRepository(repository.databasePool);
      const current = await histories.employee(id, true);
      if (!current) return null;
      if (current.status === 'INACTIVE') throw new AppError(409, 'Inactive employees cannot be updated.');
      if (Object.hasOwn(employee, 'departmentId') || Object.hasOwn(employee, 'positionId')) {
        await repository.assertPositionDepartment(employee.positionId ?? current.positionId, employee.departmentId ?? current.departmentId);
      }
      const jobHistory = current.status === 'ACTIVE'
        ? await recordJobChange(histories, current, employee)
        : null;
      const beforeAudit = await snapshot(repository.databasePool, 'employees', id, true);
      const updated = await repository.update(id, employee);
      if (updated) await recordChange(repository.databasePool, actorId, 'employees', id, 'UPDATE', beforeAudit, await snapshot(repository.databasePool, 'employees', id));
      if (!updated && jobHistory) throw new AppError(409, 'Employee changed during job update.');
      return updated && jobHistory ? { ...updated, jobHistory } : updated;
    });
  }
  async update(id, employee) {
    if (Object.hasOwn(employee, 'phone')) {
      const phone = normalizePhone(employee.phone);
      await this.assertPhoneAvailable(phone, id);
      employee = { ...employee, phone };
    }
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
