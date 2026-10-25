const { hashPassword } = require('../../common/utils/password');
const { AppError } = require('../../common/errors/app-error');

const { resolveEmployeeDistance } = require('../distance/address-resolution');
function output(row, calculation) {
  return { ...row, distanceFromHomeKm: row.distanceFromHomeKm == null ? null : Number(row.distanceFromHomeKm),
    distanceCalculation: calculation || { status: row.distanceFromHomeKm != null ? 'READY' : row.address ? 'UNAVAILABLE' : 'NOT_PROVIDED',
      reason: row.address && row.distanceFromHomeKm == null ? 'DISTANCE_NOT_AVAILABLE' : null } };
}
class EmployeesService {
  constructor({ employeesRepository, distanceService, mailTransporter, mailFrom, initialPassword }) {
    this.employeesRepository = employeesRepository;
    this.distanceService = distanceService;
    this.mailTransporter = mailTransporter;
    this.mailFrom = mailFrom;
    this.initialPassword = initialPassword;
  }

  async _createHrProfile({ actorId, hrUserId, employee }) {
    await this.assertHr(actorId);
    const checkTarget = target => {
      if (!target) throw new AppError(404, 'HR account not found.');
      if (Number(target.id) === Number(actorId)) throw new AppError(403, 'Another HR must create your profile.');
      if (target.role !== 'HR' || target.status !== 'ACTIVE') throw new AppError(403, 'Target must be an ACTIVE HR.');
      if (target.employeeId != null) throw new AppError(409, 'HR already has a profile.');
      if (target.email.trim().toLowerCase() !== employee.email) throw new AppError(400, 'Email must match the selected HR account.');
    };
    checkTarget(await this.employeesRepository.findHrTarget(hrUserId));
    const calculation = await resolveEmployeeDistance(employee.address, this.distanceService, employee.addressRefId);
    if (calculation.status !== 'READY' || !Number.isFinite(calculation.distanceFromHomeKm) || calculation.distanceFromHomeKm < 0) {
      throw new AppError(422, 'Profile was not saved because distance could not be calculated: ' + calculation.reason);
    }
    return this.employeesRepository.withTransaction(async repository => {
      // Lock both users in ID order so two HR can create each other's profiles safely.
      const accounts = new Map();
      for (const id of [...new Set([actorId, hrUserId])].sort((a,b) => a-b)) accounts.set(id, await repository.findHrTarget(id, true));
      const actor = accounts.get(actorId);
      if (actor?.role !== 'HR' || actor?.status !== 'ACTIVE') throw new AppError(403, 'Only ACTIVE HR can create profiles.');
      checkTarget(accounts.get(hrUserId));
      await repository.databasePool.query('SELECT pg_advisory_xact_lock(hashtext(lower($1)))', [employee.email]);
      if (await repository.findByEmail(employee.email)) throw new AppError(409, 'Employee email already exists.');
      if (!await repository.findActiveDepartmentById(employee.departmentId)) throw new AppError(404, 'Active department not found.');
      if (!await repository.findActivePositionById(employee.positionId)) throw new AppError(404, 'Active position not found.');
      const record = await repository.create({ ...employee, distanceFromHomeKm: calculation.distanceFromHomeKm });
      const account = await repository.linkHrProfile(hrUserId, record);
      return { ...output(record, calculation), account };
    });
  }
  async assertHr(actorId) {
    const actor = await this.employeesRepository.findUserRoleById(actorId);
    if (actor?.role !== 'HR') throw new AppError(403, 'Only HR can view employees.');
  }
  async listEmployees({ actorId, query }) {
    await this.assertHr(actorId);
    const result = await this.employeesRepository.list(query);
    return { ...result, data: result.data.map(row => output(row)) };
  }
  async getEmployee({ actorId, employeeId }) {
    await this.assertHr(actorId);
    const row = await this.employeesRepository.findById(employeeId);
    if (!row) throw new AppError(404, 'Employee not found.');
    return output(row);
  }
  async getMyProfile(userId) {
    const row = await this.employeesRepository.findOwnProfileByUserId(userId);
    if (!row) throw new AppError(404, 'No employee profile is linked to this user.');
    return output(row);
  }
  async createEmployee({ actorId, employee, distanceCache }) {
    const checks = await this.employeesRepository.preflightCreate(actorId, employee);
    if (checks.actorRole !== 'HR') throw new AppError(403, 'Only HR can create employees.');
    if (checks.emailExists) throw new AppError(409, 'Email already has an employee profile.');
    const accounts = checks.accounts || [];
    if (accounts.length > 1) throw new AppError(409, 'Multiple accounts use this email.');
    const existingAccount = accounts[0];
    if (existingAccount && Number(existingAccount.id) === Number(actorId)) throw new AppError(403, 'Another HR must create your profile.');
    if (existingAccount && (existingAccount.role !== 'HR' || existingAccount.employeeId != null || !['ACTIVE','IN_PROCESS'].includes(existingAccount.status))) {
      throw new AppError(409, 'Existing account cannot be linked: only HR without an employee profile is supported.');
    }
    if (!checks.activeDepartment) throw new AppError(404, 'Active department not found.');
    if (!checks.activePosition) throw new AppError(404, 'Active position not found.');
    if (!employee.email) throw new AppError(400, 'Email is required for the employee account.');
    if (!existingAccount && (typeof this.initialPassword !== 'string' || this.initialPassword.length < 8 || Buffer.byteLength(this.initialPassword) > 72)) {
      throw new AppError(503, 'INITIAL_USER_PASSWORD must contain at least 8 characters and at most 72 UTF-8 bytes.');
    }
    if (!existingAccount && (!this.mailTransporter || !this.mailFrom)) throw new AppError(503, 'Account email delivery is not configured.');
    // The cache belongs to one import request; no addresses or stale results are retained globally.
    const cacheKey = JSON.stringify([employee.address.trim(), employee.addressRefId || null]);
    if (distanceCache && !distanceCache.has(cacheKey)) {
      distanceCache.set(cacheKey, resolveEmployeeDistance(employee.address, this.distanceService, employee.addressRefId));
    }
    const calculation = distanceCache
      ? await distanceCache.get(cacheKey)
      : await resolveEmployeeDistance(employee.address, this.distanceService, employee.addressRefId);
    if (distanceCache && calculation.status !== 'READY') distanceCache.delete(cacheKey);
    if (calculation.status !== 'READY' || !Number.isFinite(calculation.distanceFromHomeKm) || calculation.distanceFromHomeKm < 0) {
      throw new AppError(422, 'Employee was not saved because distance could not be calculated: ' + calculation.reason);
    }
    const passwordHash = existingAccount ? null : await hashPassword(this.initialPassword);
    const created = await this.employeesRepository.createWithAccount(
      { ...employee, distanceFromHomeKm: calculation.distanceFromHomeKm }, passwordHash, actorId);
    if (created.accountCreated === false) return { ...output(created.employee, calculation), account: created.account, accountCreated: false };
    let emailDelivery = 'SENT';
    try {
      const delivery = await this.mailTransporter.sendMail({
        from: this.mailFrom, to: created.account.email, subject: 'ERIS account setup',
        text: 'Your ERIS employee account has been created.\nEmail: ' + created.account.email +
          '\nTemporary password: ' + this.initialPassword +
          '\nSign in to receive an email OTP, then verify the OTP and choose a new password. Your account remains IN_PROCESS until setup is complete.'
      });
      if (delivery?.rejected?.length || (Array.isArray(delivery?.accepted) && !delivery.accepted.length)) emailDelivery = 'FAILED';
    } catch {
      emailDelivery = 'FAILED';
    }
    return { ...output(created.employee, calculation), account: created.account, emailDelivery,
      ...(emailDelivery === 'FAILED' ? { warning: 'Profile and account saved. Email delivery failed; do not create again. HR can provide the configured temporary password securely; first login will send the activation OTP.' } : {}) };

  }

  async deleteEmployee({ actorId, employeeId }) {
    await this.assertHr(actorId);
    const actor = await this.employeesRepository.findUserRoleById(actorId);
    if (Number(actor?.employeeId) === Number(employeeId)) throw new AppError(403, 'You cannot deactivate your own profile.');
    return this.employeesRepository.deactivate(employeeId, actorId);
  }
  async updateEmployee({ actorId, employeeId, employee }) {
    if (['employeeCode', 'email', 'dateOfBirth', 'hireDate'].some(key => Object.hasOwn(employee, key))) {
      throw new AppError(400, 'employeeCode, email, dateOfBirth and hireDate cannot be updated.');
    }
    const actor = await this.employeesRepository.findUserRoleById(actorId);
    if (actor?.role !== 'HR') {
      throw new AppError(403, 'Only HR can update employees.');
    }

    if (Number(actor.employeeId) === Number(employeeId) && Object.keys(employee).some(key => !['phone', 'address', 'addressRefId'].includes(key))) {
      throw new AppError(403, 'You may only update phone and address on your own profile.');
    }
    const current = await this.employeesRepository.findById(employeeId);
    if (!current) {
      throw new AppError(404, 'Employee not found.');
    }

    if (current.employmentStatus === 'INACTIVE') throw new AppError(409, 'Inactive employees cannot be updated.');

    if (Object.hasOwn(employee, 'email')) {
      const linked = await this.employeesRepository.findLinkedAccount(employeeId);
      if (linked && employee.email?.toLowerCase() !== linked.email.toLowerCase()) {
        throw new AppError(409, 'Login email cannot be changed through the employee profile API.');
      }
    }
    if (employee.email && await this.employeesRepository.findByEmail(employee.email, employeeId)) {
      throw new AppError(409, 'Email is already in use.');
    }

    if (Object.hasOwn(employee, 'departmentId') && !await this.employeesRepository.findActiveDepartmentById(employee.departmentId)) {
      throw new AppError(404, 'Active department not found.');
    }

    if (Object.hasOwn(employee, 'positionId') && !await this.employeesRepository.findActivePositionById(employee.positionId)) {
      throw new AppError(404, 'Active position not found.');
    }

    let calculation;
    const changes = { ...employee };
    if (Object.hasOwn(employee, 'address')) {
      calculation = await resolveEmployeeDistance(employee.address, this.distanceService, employee.addressRefId);
      if (calculation.status !== 'READY' || !Number.isFinite(calculation.distanceFromHomeKm) || calculation.distanceFromHomeKm < 0) {
        throw new AppError(422, 'Employee was not updated because distance could not be calculated: ' + calculation.reason);
      }
      changes.distanceFromHomeKm = calculation.distanceFromHomeKm;
    }
    const row = this.employeesRepository.updateAuthorized
      ? await this.employeesRepository.updateAuthorized(actorId, employeeId, changes)
      : await this.employeesRepository.update(employeeId, changes);
    if (!row) {
      const latest = await this.employeesRepository.findById(employeeId);
      if (latest?.employmentStatus === 'INACTIVE') throw new AppError(409, 'Inactive employees cannot be updated.');
      throw new AppError(404, 'Employee not found.');
    }
    return output(row, calculation);
  }
}

module.exports = { EmployeesService };
