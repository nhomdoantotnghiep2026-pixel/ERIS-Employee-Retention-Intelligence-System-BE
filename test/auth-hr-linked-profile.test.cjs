const test = require('node:test');
const assert = require('node:assert/strict');
const { databasePool } = require('../src/config/database');
const { AuthRepository } = require('../src/modules/auth/auth.repository');
const { validateRegisterHrInput } = require('../src/modules/auth/auth.validation');
const { recordJobChange } = require('../src/modules/job-histories/job-histories.transition');

test('ADMIN tạo HR: tài khoản và hồ sơ IN_PROCESS liên kết, mã EMP theo ID', async () => {
  const client = await databasePool.connect();
  try {
    await client.query(`CREATE TEMP TABLE role (LIKE public.role INCLUDING ALL);
      CREATE TEMP TABLE users (LIKE public.users INCLUDING ALL);
      CREATE TEMP TABLE employees (LIKE public.employees INCLUDING ALL);
      SET search_path TO pg_temp, public;
      INSERT INTO role (name) VALUES ('ADMIN'), ('HR');`);
    const { rows: admins } = await client.query(`INSERT INTO users (email,password,role_id,status)
      SELECT 'admin@hr-test.invalid','hash',id,'ACTIVE' FROM role WHERE name='ADMIN' RETURNING id`);
    const repository = new AuthRepository({ connect: async () => ({ query: (...args) => client.query(...args), release() {} }) });
    const input = validateRegisterHrInput({email:'hr@hr-test.invalid',full_name:' HR thử nghiệm ',hireDate:'2026-11-04'});
    const account = await repository.createHrAccount(admins[0].id,input,'hash');
    const { rows } = await client.query(`SELECT u.employee_id, u.status AS user_status, e.employee_code,
      e.full_name, e.email, e.hire_date, e.employment_status, e.current_salary, e.department_id, e.position_id
      FROM users u JOIN employees e ON e.id=u.employee_id WHERE u.id=$1`,[account.id]);
    assert.equal(account.employeeId, rows[0].employee_id);
    assert.equal(rows[0].employee_code,`EMP${String(account.employeeId).padStart(3,'0')}`);
    assert.equal(rows[0].full_name,'HR thử nghiệm');
    assert.equal(rows[0].email,'hr@hr-test.invalid');
    assert.equal(rows[0].user_status,'IN_PROCESS');
    assert.equal(rows[0].employment_status,'IN_PROCESS');
    assert.equal(rows[0].current_salary,null);
    assert.equal(rows[0].department_id,null);
    assert.equal(rows[0].position_id,null);
    await assert.rejects(()=>repository.createHrAccount(admins[0].id,input,'hash'),{statusCode:409});
  } finally {
    await client.query('RESET search_path');
    await client.query('DROP TABLE IF EXISTS pg_temp.users, pg_temp.employees, pg_temp.role');
    client.release();
    await databasePool.end();
  }
});

test('Ngày tuyển HR là trường bắt buộc và phải hợp lệ', () => {
  const body={email:'hr@hr-test.invalid',full_name:'HR'};
  assert.throws(()=>validateRegisterHrInput(body),{statusCode:400});
  assert.throws(()=>validateRegisterHrInput({...body,hireDate:'2026-02-30'}),{statusCode:400});
  assert.equal(validateRegisterHrInput({...body,hireDate:'2026-11-04'}).hireDate,'2026-11-04');
});

test('Kích hoạt HR chưa có phòng ban/vị trí không tạo job history thiếu thông tin', async () => {
  const statements=[];
  const client={
    async query(sql) {
      statements.push(sql);
      if (sql.startsWith('SELECT id, status, employee_id')) return {rows:[{id:7,status:'IN_PROCESS',employeeId:9}]};
      if (sql.startsWith('UPDATE users SET password')) return {rows:[{id:7}]};
      if (sql.includes('FROM employees WHERE id')) return {rows:[{id:9,status:'IN_PROCESS',departmentId:null,positionId:null,hireDate:'2026-11-04'}]};
      return {rows:[]};
    },
    release() {}
  };
  const repository=new AuthRepository({connect:async()=>client});
  await repository.updatePassword(7,'new-hash','ACTIVE');
  assert(statements.some(sql=>sql.includes("employment_status = 'ACTIVE'")));
  assert(!statements.some(sql=>sql.includes('INSERT INTO public.employee_job_histories')));
  assert.equal(statements.at(-1),'COMMIT');
});

test('HR khác bổ sung phòng ban và vị trí lần đầu thì tạo HIRE', async () => {
  let inserted;
  const repository={
    targetDepartment:async()=>({status:'ACTIVE'}),
    targetPosition:async()=>({status:'ACTIVE',departmentId:2,jobLevel:1}),
    latest:async()=>null,
    insert:async(employeeId,data,changeType)=>{inserted={employeeId,data,changeType};return inserted;}
  };
  await recordJobChange(repository,{id:9,departmentId:null,positionId:null,hireDate:'2026-11-04'},
    {departmentId:2,positionId:3},'2026-11-04');
  assert.deepEqual(inserted,{employeeId:9,data:{departmentId:2,positionId:3,startDate:'2026-11-04',endDate:null},changeType:'HIRE'});
});
